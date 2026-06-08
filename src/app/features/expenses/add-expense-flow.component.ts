import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import Decimal from 'decimal.js';
import { AppPreferencesService, SUPPORTED_CURRENCIES } from '../../core/app-preferences.service';
import { CurrencyDisplayService } from '../../core/currency-display.service';
import {
  CURRENT_USER_ID,
  CreateExpenseInput,
  EventSourcingService,
  Friend,
  Group,
  SplitMode,
  currencyMinorUnits,
  formatMinorUnits,
  parseAmountToMinorUnits,
  splitEqualMinorUnits,
  splitPercentMinorUnits,
} from '../../core/event-sourcing.service';
import { sampleFxRateToUsd } from '../../core/fx-rates';

interface MoneyRow {
  userId: string;
  amount: string;
}

interface ParticipantRow extends MoneyRow {
  selected: boolean;
  percent: string;
}

@Component({
  selector: 'app-add-expense-flow',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatNativeDateModule,
    MatSelectModule,
    MatSnackBarModule,
    MatToolbarModule,
    RouterLink,
  ],
  templateUrl: './add-expense-flow.component.html',
  styleUrl: './add-expense-flow.component.scss',
})
export class AddExpenseFlowComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly eventService = inject(EventSourcingService);
  private readonly preferences = inject(AppPreferencesService);
  private readonly currencyDisplay = inject(CurrencyDisplayService);

  protected readonly currentUserId = CURRENT_USER_ID;
  protected readonly currencies = SUPPORTED_CURRENCIES;
  protected readonly groupId = this.route.snapshot.paramMap.get('groupId');
  protected readonly description = signal('');
  protected readonly currency = signal<string>(this.preferences.globalCurrency());
  protected readonly total = signal('0.00');
  protected readonly date = signal(new Date());
  protected readonly time = signal(new Date().toTimeString().slice(0, 5));
  protected readonly splitMode = signal<SplitMode>('equal');
  protected readonly fxRateToUsd = signal<string | null>(null);
  protected readonly fxError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly payers = signal<MoneyRow[]>([{ userId: CURRENT_USER_ID, amount: '0.00' }]);
  protected readonly participants = signal<ParticipantRow[]>([]);

  private groups: Group[] = [];
  private friends: Friend[] = [];
  private groupMembers: Record<string, Friend[]> = {};
  private initialized = false;

  protected readonly selectedParticipants = computed(() =>
    this.participants().filter((participant) => participant.selected),
  );
  protected readonly selectedMembers = computed(() => {
    const selectedIds = new Set(
      this.selectedParticipants().map((participant) => participant.userId),
    );
    return this.memberOptions().filter((member) => selectedIds.has(member.friendId));
  });
  protected readonly validationMessage = computed(() => this.validate());

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.eventService.groups$.pipe(takeUntilDestroyed(destroyRef)).subscribe((groups) => {
      this.groups = groups;
    });
    this.eventService.friends$.pipe(takeUntilDestroyed(destroyRef)).subscribe((friends) => {
      this.friends = friends;
      this.initializeRows();
    });
    this.eventService.groupMembers$.pipe(takeUntilDestroyed(destroyRef)).subscribe((members) => {
      this.groupMembers = members;
      this.initializeRows();
    });
  }

  protected isGroupScoped(): boolean {
    return Boolean(this.groupId);
  }

  protected backLink(): string {
    return this.groupId ? `/groups/${this.groupId}` : '/';
  }

  protected setCurrency(currency: string): void {
    this.currency.set(currency);
    this.fxRateToUsd.set(null);
    this.fxError.set(null);
    this.resetDefaultAmounts();
  }

  protected setTotal(total: string): void {
    this.total.set(total);
    this.fxRateToUsd.set(null);
    this.fxError.set(null);
    this.resetDefaultAmounts();
  }

  protected setSplitMode(mode: SplitMode): void {
    this.splitMode.set(mode);
    this.resetSplitAmounts();
  }

  protected setParticipantSelected(index: number, selected: boolean): void {
    this.participants.update((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, selected } : row)),
    );
    this.resetDefaultAmounts();
  }

  protected addPayer(): void {
    const used = new Set(this.payers().map((payer) => payer.userId));
    const next = this.selectedMembers().find((member) => !used.has(member.friendId));

    if (next) {
      this.payers.update((rows) => [...rows, { userId: next.friendId, amount: '0.00' }]);
    }
  }

  protected removePayer(index: number): void {
    if (this.payers().length > 1) {
      this.payers.update((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    }
  }

  protected setPayerUser(index: number, userId: string): void {
    this.payers.update((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, userId } : row)),
    );
  }

  protected setPayerAmount(index: number, amount: string): void {
    this.payers.update((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, amount } : row)),
    );
  }

  protected setParticipantAmount(userId: string, amount: string): void {
    this.participants.update((rows) =>
      rows.map((row) => (row.userId === userId ? { ...row, amount } : row)),
    );
  }

  protected setParticipantPercent(userId: string, percent: string): void {
    this.participants.update((rows) =>
      rows.map((row) => (row.userId === userId ? { ...row, percent } : row)),
    );
    this.resetSplitAmounts();
  }

  protected async save(): Promise<void> {
    const validation = this.validate();

    if (validation || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.fxError.set(null);

    try {
      const groupId = await this.ensureGroup();
      const fxRateToUsd = await this.ensureFxRate();
      const input: CreateExpenseInput = {
        groupId,
        description: this.description().trim(),
        currency: this.currency(),
        transactionAt: this.transactionAtIso(),
        fxRateToUsd,
        paidBy: this.readPayers(),
        owedBy: this.readOwedRows(),
      };

      await this.eventService.createExpense(input);
      this.snackBar.open('Expense saved to the local event log.', 'OK', { duration: 2600 });
      await this.router.navigate(['/groups', groupId]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save expense.';
      this.fxError.set(message);
      this.persistDraft();
      this.snackBar.open(message, 'OK', { duration: 4200 });
    } finally {
      this.saving.set(false);
    }
  }

  protected nameFor(userId: string): string {
    return this.friends.find((friend) => friend.friendId === userId)?.displayName ?? userId;
  }

  protected fxLabel(): string {
    if (this.fxRateToUsd()) {
      return `Sample anchor: 1 ${this.currency()} = $${this.fxRateToUsd()} USD · Display total ${this.displayTotalLabel()}`;
    }

    return this.fxError() ?? 'Sample FX will be anchored at save time.';
  }

  protected displayTotalLabel(): string {
    const rate = this.fxRateToUsd();

    if (!rate) {
      return `${this.currencyDisplay.currency()} pending`;
    }

    return this.currencyDisplay.formatUsdMicros(this.totalUsdMicros(rate));
  }

  protected scopeLabel(): string {
    if (!this.groupId) {
      return 'Direct expense';
    }

    return this.groups.find((group) => group.groupId === this.groupId)?.name ?? 'Group expense';
  }

  protected selectedNames(): string {
    const names = this.selectedParticipants().map((participant) =>
      this.nameFor(participant.userId),
    );

    if (names.length === 0) {
      return 'Choose at least two people.';
    }

    if (names.length <= 3) {
      return names.join(', ');
    }

    return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
  }

  protected payerSummary(): string {
    const payers = this.payers().filter((payer) => payer.amount !== '0.00');

    if (payers.length === 1) {
      return payers[0].userId === CURRENT_USER_ID ? 'you' : this.nameFor(payers[0].userId);
    }

    return `${payers.length || this.payers().length} people`;
  }

  protected splitModeLabel(): string {
    if (this.splitMode() === 'equal') {
      return 'equally';
    }

    if (this.splitMode() === 'exact') {
      return 'by exact amounts';
    }

    return 'by percentage';
  }

  private totalUsdMicros(rate: string): number {
    const amountMinor = this.totalMinor();
    const scale = new Decimal(10).pow(currencyMinorUnits(this.currency()));
    const usdMicros = new Decimal(amountMinor)
      .div(scale)
      .mul(rate)
      .mul(1_000_000)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
    return usdMicros;
  }

  private initializeRows(): void {
    const members = this.memberOptions();

    if (this.initialized || members.length === 0) {
      return;
    }

    this.initialized = true;
    this.participants.set(
      members.map((member) => ({
        userId: member.friendId,
        selected:
          this.isGroupScoped() ||
          member.friendId === CURRENT_USER_ID ||
          member.friendId === 'user-bob',
        amount: '0.00',
        percent: '0',
      })),
    );
    this.resetDefaultAmounts();
  }

  private memberOptions(): Friend[] {
    if (this.groupId) {
      return this.groupMembers[this.groupId] ?? [];
    }

    return this.friends.filter((friend) => friend.status === 'ACTIVE');
  }

  private resetDefaultAmounts(): void {
    const total = safeFormat(this.total(), this.currency());
    this.payers.set([{ userId: CURRENT_USER_ID, amount: total }]);
    this.resetSplitAmounts();
  }

  private resetSplitAmounts(): void {
    const totalMinor = this.totalMinor();
    const selected = this.selectedParticipants();

    if (selected.length === 0) {
      return;
    }

    try {
      if (this.splitMode() === 'equal') {
        const split = splitEqualMinorUnits(
          totalMinor,
          selected.map((participant) => participant.userId),
        );
        this.applyParticipantAmounts(split);
      }

      if (this.splitMode() === 'percent') {
        const split = splitPercentMinorUnits(
          totalMinor,
          selected.map((participant) => ({
            userId: participant.userId,
            percent: participant.percent,
          })),
        );
        this.applyParticipantAmounts(split);
      }
    } catch {
      this.applyParticipantAmounts(
        selected.map((participant) => ({ userId: participant.userId, amountMinor: 0 })),
      );
    }
  }

  private applyParticipantAmounts(split: Array<{ userId: string; amountMinor: number }>): void {
    const amountByUser = new Map(
      split.map((row) => [row.userId, formatMinorUnits(row.amountMinor, this.currency())]),
    );
    this.participants.update((rows) =>
      rows.map((row) => ({
        ...row,
        amount: amountByUser.get(row.userId) ?? row.amount,
      })),
    );
  }

  private validate(): string | null {
    try {
      const totalMinor = this.totalMinor();
      const selected = this.selectedParticipants();

      if (!this.description().trim()) {
        return 'Description is required.';
      }

      if (totalMinor <= 0) {
        return 'Enter a positive amount.';
      }

      if (selected.length < 2) {
        return 'Choose at least two participants.';
      }

      if (this.splitMode() === 'percent') {
        const percents = selected.map((participant) => new Decimal(participant.percent || '0'));
        const hasInvalid = percents.some((percent) => percent.lt(0) || percent.gt(100));
        const totalPercent = percents.reduce((sum, percent) => sum.plus(percent), new Decimal(0));

        if (hasInvalid || !totalPercent.eq(100)) {
          return 'Percent split must total 100%.';
        }
      }

      const paid = this.readPayers().reduce((sum, row) => sum + row.amountMinor, 0);
      const owed = this.readOwedRows().reduce((sum, row) => sum + row.amountMinor, 0);

      if (paid !== totalMinor) {
        return `Paid total must equal ${formatMinorUnits(totalMinor, this.currency())} ${this.currency()}.`;
      }

      if (owed !== totalMinor) {
        return `Split total must equal ${formatMinorUnits(totalMinor, this.currency())} ${this.currency()}.`;
      }

      if (new Set(this.payers().map((payer) => payer.userId)).size !== this.payers().length) {
        return 'Each payer can appear only once.';
      }

      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Expense is invalid.';
    }
  }

  private readPayers(): Array<{ userId: string; amountMinor: number }> {
    return this.payers()
      .map((payer) => ({
        userId: payer.userId,
        amountMinor: parseAmountToMinorUnits(payer.amount, this.currency()),
      }))
      .filter((payer) => payer.amountMinor > 0);
  }

  private readOwedRows(): Array<{ userId: string; amountMinor: number }> {
    return this.selectedParticipants()
      .map((participant) => ({
        userId: participant.userId,
        amountMinor: parseAmountToMinorUnits(participant.amount, this.currency()),
      }))
      .filter((participant) => participant.amountMinor > 0);
  }

  private totalMinor(): number {
    return parseAmountToMinorUnits(this.total(), this.currency());
  }

  private async ensureGroup(): Promise<string> {
    if (this.groupId) {
      return this.groupId;
    }

    const memberIds = this.selectedParticipants().map((participant) => participant.userId);
    const groupId = `direct-${[...memberIds].sort().join('-')}`;

    if (!this.groups.some((group) => group.groupId === groupId)) {
      await this.eventService.createGroup({
        groupId,
        name: `Direct: ${memberIds.map((memberId) => this.nameFor(memberId)).join(', ')}`,
        memberIds,
        defaultCurrency: this.currency(),
      });
    }

    return groupId;
  }

  private async ensureFxRate(): Promise<string> {
    const rateString = sampleFxRateToUsd(this.currency());
    this.fxRateToUsd.set(rateString);
    return rateString;
  }

  private transactionAtIso(): string {
    const date = this.date();
    const [hours, minutes] = this.time().split(':').map(Number);
    const next = new Date(date);
    next.setHours(hours || 0, minutes || 0, 0, 0);
    return next.toISOString();
  }

  private persistDraft(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(
      'dutch.expenseDraft',
      JSON.stringify({
        description: this.description(),
        currency: this.currency(),
        total: this.total(),
        date: this.date().toISOString(),
        time: this.time(),
        groupId: this.groupId,
        payers: this.payers(),
        participants: this.participants(),
      }),
    );
  }
}

function safeFormat(amount: string, currency: string): string {
  try {
    return formatMinorUnits(parseAmountToMinorUnits(amount, currency), currency);
  } catch {
    return '0.00';
  }
}
