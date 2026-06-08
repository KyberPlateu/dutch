import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  CreateExpenseInput,
  EventSourcingService,
  SplitMode,
  formatMinorUnits,
  parseAmountToMinorUnits,
  splitEqualMinorUnits,
  splitPercentMinorUnits,
} from '../../core/event-sourcing.service';
import { AppPreferencesService } from '../../core/app-preferences.service';
import { CurrencyDisplayService } from '../../core/currency-display.service';
import { sampleFxRateToUsd } from '../../core/fx-rates';

type FxState = 'idle' | 'loading' | 'ready' | 'failed';

interface PersonOption {
  id: string;
  name: string;
}

interface MoneyRowForm {
  userId: FormControl<string>;
  amount: FormControl<string>;
  percent: FormControl<string>;
}

@Component({
  selector: 'app-add-expense',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './add-expense.component.html',
  styleUrl: './add-expense.component.scss',
})
export class AddExpenseComponent {
  protected readonly eventService = inject(EventSourcingService);
  private readonly preferences = inject(AppPreferencesService);
  private readonly currencyDisplay = inject(CurrencyDisplayService);
  private readonly fb = inject(FormBuilder);

  protected readonly people: PersonOption[] = [
    { id: 'user-alice', name: 'Alice' },
    { id: 'user-bob', name: 'Bob' },
    { id: 'user-charlie', name: 'Charlie' },
    { id: 'user-diana', name: 'Diana' },
  ];

  protected readonly fxState = signal<FxState>('idle');
  protected readonly fxRateToUsd = signal<string | null>(null);
  protected readonly fxError = signal<string | null>(null);
  protected readonly splitMode = signal<SplitMode>('equal');
  private readonly formRevision = signal(0);

  protected readonly form = this.fb.group({
    groupId: this.fb.nonNullable.control('group-trip', Validators.required),
    currency: this.fb.nonNullable.control(this.preferences.globalCurrency(), Validators.required),
    total: this.fb.nonNullable.control('0.00', Validators.required),
    date: this.fb.nonNullable.control(new Date().toISOString().slice(0, 10), Validators.required),
    time: this.fb.nonNullable.control(''),
    description: this.fb.nonNullable.control('', Validators.required),
    payers: this.fb.array([this.createMoneyRow('user-alice', '0.00')]),
    participants: this.fb.array([
      this.createMoneyRow('user-alice', '0.00', '50'),
      this.createMoneyRow('user-bob', '0.00', '50'),
    ]),
  });

  protected readonly currency = computed(() => this.form.controls.currency.value);
  protected readonly totalDisplay = computed(() => {
    this.formRevision();
    try {
      return formatMinorUnits(this.totalMinor(), this.currency());
    } catch {
      return '0.00';
    }
  });

  protected readonly validationMessage = computed(() => {
    this.formRevision();
    return this.validateForm();
  });
  protected readonly submitDisabled = computed(
    () => this.form.invalid || Boolean(this.validationMessage()) || this.fxState() === 'loading',
  );
  protected readonly fxLabel = computed(() => {
    if (this.fxState() === 'loading') {
      return 'Fetching FX';
    }

    if (this.fxState() === 'ready') {
      return `FX ${this.fxRateToUsd()}`;
    }

    if (this.fxState() === 'failed') {
      return this.fxError() ?? 'FX failed';
    }

    return 'FX pending';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.form.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
    });
  }

  get payers(): FormArray<ReturnType<AddExpenseComponent['createMoneyRow']>> {
    return this.form.controls.payers;
  }

  get participants(): FormArray<ReturnType<AddExpenseComponent['createMoneyRow']>> {
    return this.form.controls.participants;
  }

  protected addPayer(): void {
    this.payers.push(this.createMoneyRow(this.people[0].id, '0.00'));
  }

  protected removePayer(index: number): void {
    if (this.payers.length > 1) {
      this.payers.removeAt(index);
    }
  }

  protected addParticipant(): void {
    this.participants.push(this.createMoneyRow(this.people[0].id, '0.00', '0'));
    this.syncSplitFromMode();
    this.bumpFormRevision();
  }

  protected removeParticipant(index: number): void {
    if (this.participants.length > 1) {
      this.participants.removeAt(index);
      this.syncSplitFromMode();
      this.bumpFormRevision();
    }
  }

  protected setSplitMode(mode: SplitMode): void {
    this.splitMode.set(mode);
    this.syncSplitFromMode();
    this.bumpFormRevision();
  }

  protected resetFx(): void {
    this.fxState.set('idle');
    this.fxRateToUsd.set(null);
    this.fxError.set(null);
    this.syncSplitFromMode();
    this.bumpFormRevision();
  }

  protected syncSplitFromMode(): void {
    try {
      const mode = this.splitMode();
      const totalMinor = this.totalMinor();

      if (mode === 'equal') {
        const split = splitEqualMinorUnits(
          totalMinor,
          this.participants.controls.map((row) => row.controls.userId.value),
        );
        split.forEach((row, index) => {
          this.participants
            .at(index)
            .controls.amount.setValue(formatMinorUnits(row.amountMinor, this.currency()), {
              emitEvent: false,
            });
        });
        this.bumpFormRevision();
      }

      if (mode === 'percent') {
        const split = splitPercentMinorUnits(
          totalMinor,
          this.participants.controls.map((row) => ({
            userId: row.controls.userId.value,
            percent: row.controls.percent.value,
          })),
        );
        split.forEach((row, index) => {
          this.participants
            .at(index)
            .controls.amount.setValue(formatMinorUnits(row.amountMinor, this.currency()), {
              emitEvent: false,
            });
        });
        this.bumpFormRevision();
      }
    } catch {
      return;
    }
  }

  protected async submit(): Promise<void> {
    const validation = this.validateForm();

    if (validation) {
      return;
    }

    try {
      const fxRateToUsd = await this.ensureFxRate();

      const input: CreateExpenseInput = {
        groupId: this.form.controls.groupId.value,
        description: this.form.controls.description.value,
        currency: this.currency(),
        transactionAt: this.transactionAtIso(),
        fxRateToUsd,
        paidBy: this.readMoneyRows(this.payers),
        owedBy: this.readMoneyRows(this.participants),
      };

      await this.eventService.createExpense(input);
      this.fxState.set('ready');
    } catch (error) {
      this.fxState.set('failed');
      this.fxError.set(error instanceof Error ? error.message : 'Could not save expense.');
    }
  }

  protected nameFor(userId: string): string {
    return this.people.find((person) => person.id === userId)?.name ?? userId;
  }

  protected money(amountUsdMicros: number): string {
    return this.currencyDisplay.formatUsdMicros(amountUsdMicros);
  }

  private createMoneyRow(userId: string, amount: string, percent = '0') {
    return this.fb.group<MoneyRowForm>({
      userId: this.fb.nonNullable.control(userId, Validators.required),
      amount: this.fb.nonNullable.control(amount, Validators.required),
      percent: this.fb.nonNullable.control(percent, Validators.required),
    });
  }

  private validateForm(): string | null {
    try {
      const totalMinor = this.totalMinor();
      const paidMinor = this.readMoneyRows(this.payers).reduce(
        (sum, row) => sum + row.amountMinor,
        0,
      );
      const owedMinor = this.readMoneyRows(this.participants).reduce(
        (sum, row) => sum + row.amountMinor,
        0,
      );

      if (totalMinor <= 0) {
        return 'Enter a positive total amount.';
      }

      if (paidMinor !== totalMinor) {
        return `Paid total must equal ${formatMinorUnits(totalMinor, this.currency())} ${this.currency()}.`;
      }

      if (owedMinor !== totalMinor) {
        return `Split total must equal ${formatMinorUnits(totalMinor, this.currency())} ${this.currency()}.`;
      }

      if (
        new Set(this.payers.controls.map((row) => row.controls.userId.value)).size !==
        this.payers.length
      ) {
        return 'Each payer can appear only once.';
      }

      if (
        new Set(this.participants.controls.map((row) => row.controls.userId.value)).size !==
        this.participants.length
      ) {
        return 'Each participant can appear only once.';
      }

      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Expense details are invalid.';
    }
  }

  private totalMinor(): number {
    return parseAmountToMinorUnits(this.form.controls.total.value, this.currency());
  }

  private bumpFormRevision(): void {
    this.formRevision.update((revision) => revision + 1);
  }

  private readMoneyRows(rows: FormArray<ReturnType<AddExpenseComponent['createMoneyRow']>>) {
    return rows.controls.map((row) => ({
      userId: row.controls.userId.value,
      amountMinor: parseAmountToMinorUnits(row.controls.amount.value, this.currency()),
    }));
  }

  private async ensureFxRate(): Promise<string> {
    const currency = this.currency();
    const rateString = sampleFxRateToUsd(currency);
    this.fxRateToUsd.set(rateString);
    this.fxState.set('ready');
    this.fxError.set(null);
    return rateString;
  }

  private transactionAtIso(): string {
    const date = this.form.controls.date.value;
    const time = this.form.controls.time.value || '12:00';
    return new Date(`${date}T${time}:00`).toISOString();
  }
}
