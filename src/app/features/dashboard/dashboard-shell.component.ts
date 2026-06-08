import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { AppPreferencesService, SUPPORTED_CURRENCIES } from '../../core/app-preferences.service';
import { CurrencyDisplayService } from '../../core/currency-display.service';
import {
  DashboardAggregate,
  EventSourcingService,
  SyncState,
} from '../../core/event-sourcing.service';
import { AddFriendDialogComponent } from '../friends/add-friend-dialog.component';
import { GroupEditorDialogComponent } from '../groups/group-editor-dialog.component';
import { ThemeSelectorComponent } from '../../shared/theme-selector.component';

const EMPTY_DASHBOARD: DashboardAggregate = {
  totalYouOweUsdMicros: 0,
  totalYouAreOwedUsdMicros: 0,
  pendingApprovalCount: 0,
  groupCount: 0,
  friendCount: 0,
  recentActivity: [],
  friendBalances: [],
  groupSummaries: [],
};

const EMPTY_SYNC: SyncState = {
  online: true,
  syncing: false,
  pendingEvents: 0,
};

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatBadgeModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTabsModule,
    MatToolbarModule,
    RouterLink,
    ThemeSelectorComponent,
  ],
  templateUrl: './dashboard-shell.component.html',
  styleUrl: './dashboard-shell.component.scss',
})
export class DashboardShellComponent {
  private readonly eventService = inject(EventSourcingService);
  private readonly preferences = inject(AppPreferencesService);
  private readonly currencyDisplay = inject(CurrencyDisplayService);
  private readonly dialog = inject(MatDialog);

  protected readonly currencies = SUPPORTED_CURRENCIES;
  protected readonly globalCurrency = this.preferences.globalCurrency;
  protected readonly dashboard = toSignal(this.eventService.dashboard$, {
    initialValue: EMPTY_DASHBOARD,
  });
  protected readonly sync = toSignal(this.eventService.syncState$, {
    initialValue: EMPTY_SYNC,
  });
  protected readonly syncLabel = computed(() => {
    const state = this.sync();

    if (!state.online) {
      return 'Offline';
    }

    if (state.pendingEvents > 0) {
      return `${state.pendingEvents} local`;
    }

    return 'Local ready';
  });

  protected openAddFriend(): void {
    this.dialog.open(AddFriendDialogComponent, {
      autoFocus: 'first-tabbable',
      width: 'min(28rem, 92vw)',
    });
  }

  protected openCreateGroup(): void {
    this.dialog.open(GroupEditorDialogComponent, {
      autoFocus: 'first-tabbable',
      width: 'min(34rem, 94vw)',
    });
  }

  protected setGlobalCurrency(currency: string): void {
    this.preferences.setGlobalCurrency(currency);
  }

  protected money(amountUsdMicros: number): string {
    return this.currencyDisplay.formatUsdMicros(amountUsdMicros);
  }

  protected balanceText(netUsdMicros: number): string {
    if (netUsdMicros > 0) {
      return `Owes you ${this.money(netUsdMicros)}`;
    }

    if (netUsdMicros < 0) {
      return `You owe ${this.money(Math.abs(netUsdMicros))}`;
    }

    return 'Settled up';
  }

  protected groupText(netUsdMicros: number): string {
    if (netUsdMicros > 0) {
      return `Owed ${this.money(netUsdMicros)}`;
    }

    if (netUsdMicros < 0) {
      return `Owe ${this.money(Math.abs(netUsdMicros))}`;
    }

    return 'Settled';
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  protected iconFor(eventType: string): string {
    if (eventType.startsWith('PAYMENT')) {
      return 'payments';
    }

    if (eventType.startsWith('GROUP')) {
      return 'groups';
    }

    if (eventType.startsWith('FRIEND')) {
      return 'person_add';
    }

    return 'receipt_long';
  }

  protected tagText(tag: string): string {
    return tag === 'group' ? 'Group event' : tag;
  }
}
