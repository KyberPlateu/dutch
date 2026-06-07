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
  template: `
    <main class="min-h-screen bg-neutral-950 text-neutral-100">
      <section class="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.4fr_0.8fr]">
        <form
          class="rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-xl shadow-black/20 sm:p-6"
          [formGroup]="form"
          (ngSubmit)="submit()"
        >
          <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 class="text-2xl font-semibold tracking-normal text-white">Dutch</h1>
              <p class="text-sm text-neutral-400">Add a USD-anchored shared expense</p>
            </div>
            <span
              class="rounded-md border px-3 py-1 text-xs font-medium"
              [ngClass]="{
                'border-emerald-700 bg-emerald-950 text-emerald-200': fxState() === 'ready',
                'border-red-700 bg-red-950 text-red-200': fxState() === 'failed',
                'border-sky-700 bg-sky-950 text-sky-200': fxState() === 'loading',
                'border-neutral-700 bg-neutral-900 text-neutral-300': fxState() === 'idle'
              }"
            >
              {{ fxLabel() }}
            </span>
          </header>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-2 text-sm">
              <span class="text-neutral-300">Group</span>
              <select class="control" formControlName="groupId">
                <option value="group-trip">Trip to Amsterdam</option>
                <option value="group-home">Flatmates</option>
              </select>
            </label>

            <label class="grid gap-2 text-sm">
              <span class="text-neutral-300">Currency</span>
              <select class="control" formControlName="currency" (change)="resetFx()">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="INR">INR</option>
                <option value="JPY">JPY</option>
              </select>
            </label>

            <label class="grid gap-2 text-sm">
              <span class="text-neutral-300">Total amount</span>
              <input
                class="control"
                inputmode="decimal"
                placeholder="0.00"
                formControlName="total"
                (input)="syncSplitFromMode()"
              />
            </label>

            <label class="grid gap-2 text-sm">
              <span class="text-neutral-300">Date</span>
              <input class="control" type="date" formControlName="date" />
            </label>

            <label class="grid gap-2 text-sm">
              <span class="text-neutral-300">Time</span>
              <input class="control" type="time" formControlName="time" />
            </label>

            <label class="grid gap-2 text-sm">
              <span class="text-neutral-300">Description</span>
              <input class="control" placeholder="Dinner, taxi, tickets..." formControlName="description" />
            </label>
          </div>

          <section class="mt-6 grid gap-3">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-semibold text-white">Who paid</h2>
              <button class="secondary-button" type="button" (click)="addPayer()">Add payer</button>
            </div>

            <div class="grid gap-2" formArrayName="payers">
              <div
                class="grid gap-2 rounded-md border border-neutral-800 bg-neutral-950 p-3 sm:grid-cols-[1fr_140px_auto]"
                *ngFor="let row of payers.controls; let index = index"
                [formGroupName]="index"
              >
                <select class="control" formControlName="userId">
                  <option *ngFor="let person of people" [value]="person.id">{{ person.name }}</option>
                </select>
                <input
                  class="control"
                  inputmode="decimal"
                  placeholder="0.00"
                  formControlName="amount"
                />
                <button
                  class="icon-button"
                  type="button"
                  title="Remove payer"
                  (click)="removePayer(index)"
                  [disabled]="payers.length === 1"
                >
                  -
                </button>
              </div>
            </div>
          </section>

          <section class="mt-6 grid gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="text-base font-semibold text-white">Who owes</h2>
              <div class="segmented">
                <button
                  type="button"
                  [class.active]="splitMode() === 'equal'"
                  (click)="setSplitMode('equal')"
                >
                  Equal
                </button>
                <button
                  type="button"
                  [class.active]="splitMode() === 'exact'"
                  (click)="setSplitMode('exact')"
                >
                  Exact
                </button>
                <button
                  type="button"
                  [class.active]="splitMode() === 'percent'"
                  (click)="setSplitMode('percent')"
                >
                  %
                </button>
              </div>
            </div>

            <div class="grid gap-2" formArrayName="participants">
              <div
                class="grid gap-2 rounded-md border border-neutral-800 bg-neutral-950 p-3 sm:grid-cols-[1fr_120px_140px_auto]"
                *ngFor="let row of participants.controls; let index = index"
                [formGroupName]="index"
              >
                <select class="control" formControlName="userId" (change)="syncSplitFromMode()">
                  <option *ngFor="let person of people" [value]="person.id">{{ person.name }}</option>
                </select>
                <input
                  class="control"
                  inputmode="decimal"
                  placeholder="0"
                  formControlName="percent"
                  [readonly]="splitMode() !== 'percent'"
                  (input)="syncSplitFromMode()"
                />
                <input
                  class="control"
                  inputmode="decimal"
                  placeholder="0.00"
                  formControlName="amount"
                  [readonly]="splitMode() === 'equal' || splitMode() === 'percent'"
                />
                <button
                  class="icon-button"
                  type="button"
                  title="Remove participant"
                  (click)="removeParticipant(index)"
                  [disabled]="participants.length === 1"
                >
                  -
                </button>
              </div>
            </div>

            <button class="secondary-button w-fit" type="button" (click)="addParticipant()">
              Add participant
            </button>
          </section>

          <div
            class="mt-5 rounded-md border p-3 text-sm"
            [ngClass]="validationMessage() ? 'border-red-800 bg-red-950 text-red-100' : 'border-emerald-800 bg-emerald-950 text-emerald-100'"
          >
            {{ validationMessage() || 'Paid and split totals match exactly.' }}
          </div>

          <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-neutral-400">
              Native total: {{ totalDisplay() }} {{ currency() }}
            </p>
            <button class="primary-button" type="submit" [disabled]="submitDisabled()">
              Save expense
            </button>
          </div>
        </form>

        <aside class="grid content-start gap-4">
          <section class="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h2 class="text-base font-semibold text-white">Queue</h2>
            <div class="mt-3 grid gap-2 text-sm text-neutral-300" *ngIf="eventService.syncState$ | async as sync">
              <p>Connection: {{ sync.online ? 'online' : 'offline' }}</p>
              <p>Pending events: {{ sync.pendingEvents }}</p>
              <p *ngIf="sync.lastError" class="text-red-300">{{ sync.lastError }}</p>
            </div>
          </section>

          <section class="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h2 class="text-base font-semibold text-white">Balances</h2>
            <div class="mt-3 grid gap-2 text-sm text-neutral-300">
              <p *ngFor="let balance of eventService.balances$ | async">
                {{ nameFor(balance.fromUserId) }} owes {{ nameFor(balance.toUserId) }}
                {{ money(balance.amountUsdMicros) }}
              </p>
              <p *ngIf="(eventService.balances$ | async)?.length === 0">No balances yet.</p>
            </div>
          </section>

          <section class="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <h2 class="text-base font-semibold text-white">Payment approvals</h2>
            <div class="mt-3 grid gap-2 text-sm text-neutral-300">
              <p *ngFor="let settlement of eventService.pendingSettlements$ | async">
                {{ nameFor(settlement.payeeId) }} must approve {{ money(settlement.amountUsdMicros) }}
                from {{ nameFor(settlement.payerId) }}.
              </p>
              <p *ngIf="(eventService.pendingSettlements$ | async)?.length === 0">
                No pending approvals.
              </p>
            </div>
          </section>
        </aside>
      </section>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .control {
        width: 100%;
        border-radius: 0.375rem;
        border: 1px solid rgb(64 64 64);
        background: rgb(10 10 10);
        padding: 0.625rem 0.75rem;
        color: white;
        outline: none;
      }

      .control:focus {
        border-color: rgb(14 165 233);
        box-shadow: 0 0 0 2px rgb(14 165 233 / 0.2);
      }

      .control[readonly] {
        color: rgb(163 163 163);
      }

      .primary-button,
      .secondary-button,
      .icon-button,
      .segmented button {
        border-radius: 0.375rem;
        font-weight: 600;
        transition:
          background-color 120ms ease,
          border-color 120ms ease,
          color 120ms ease;
      }

      .primary-button {
        background: rgb(14 165 233);
        color: rgb(8 47 73);
        padding: 0.75rem 1rem;
      }

      .primary-button:disabled,
      .secondary-button:disabled,
      .icon-button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      .secondary-button,
      .icon-button {
        border: 1px solid rgb(64 64 64);
        background: rgb(23 23 23);
        color: rgb(229 229 229);
        padding: 0.5rem 0.75rem;
      }

      .icon-button {
        min-width: 2.5rem;
      }

      .segmented {
        display: inline-grid;
        grid-template-columns: repeat(3, minmax(4rem, 1fr));
        overflow: hidden;
        border-radius: 0.375rem;
        border: 1px solid rgb(64 64 64);
      }

      .segmented button {
        background: rgb(23 23 23);
        color: rgb(212 212 212);
        padding: 0.5rem 0.75rem;
      }

      .segmented button.active {
        background: rgb(14 165 233);
        color: rgb(8 47 73);
      }
    `,
  ],
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
    () =>
      this.form.invalid ||
      Boolean(this.validationMessage()) ||
      this.fxState() === 'loading',
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
      const paidMinor = this.readMoneyRows(this.payers).reduce((sum, row) => sum + row.amountMinor, 0);
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

      if (new Set(this.payers.controls.map((row) => row.controls.userId.value)).size !== this.payers.length) {
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
