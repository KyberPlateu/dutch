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
  ],
  template: `
    <main class="dashboard-page">
      <mat-toolbar class="topbar">
        <div class="brand">
          <span class="brand-mark">D</span>
          <span>Dutch</span>
        </div>
        <span class="spacer"></span>
        <span class="sync-pill" [class.pending]="sync().pendingEvents > 0">
          {{ syncLabel() }}
        </span>
        <button mat-icon-button type="button" aria-label="Add friend" (click)="openAddFriend()">
          <mat-icon>person_add</mat-icon>
        </button>
        <button mat-icon-button type="button" aria-label="Create group" (click)="openCreateGroup()">
          <mat-icon>group_add</mat-icon>
        </button>
      </mat-toolbar>

      @if (sync().syncing) {
        <mat-progress-bar mode="indeterminate"></mat-progress-bar>
      }

      <section class="dashboard-grid">
        <section class="balance-panel">
          <p class="eyebrow">Overall balance</p>
          <h1>You are owed {{ money(dashboard().totalYouAreOwedUsdMicros) }}</h1>
          <div class="balance-row">
            <span class="positive">Owed to you {{ money(dashboard().totalYouAreOwedUsdMicros) }}</span>
            <span class="negative">You owe {{ money(dashboard().totalYouOweUsdMicros) }}</span>
          </div>
          <mat-form-field class="currency-field" appearance="outline">
            <mat-label>Global currency</mat-label>
            <mat-select [ngModel]="globalCurrency()" (ngModelChange)="setGlobalCurrency($event)">
              @for (currency of currencies; track currency) {
                <mat-option [value]="currency">{{ currency }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <div class="quick-actions">
            <a mat-flat-button color="primary" routerLink="/expenses/new">
              <mat-icon>add</mat-icon>
              Add expense
            </a>
            <button mat-stroked-button type="button" (click)="openAddFriend()">
              <mat-icon>person_add</mat-icon>
              Add friend
            </button>
            <button mat-stroked-button type="button" (click)="openCreateGroup()">
              <mat-icon>group_add</mat-icon>
              Create group
            </button>
          </div>
        </section>

        <section class="lists-panel">
          <section class="group-overview">
            <div class="section-title">
              <h2>Groups</h2>
              <button mat-button type="button" (click)="openCreateGroup()">
                <mat-icon>add</mat-icon>
                Create
              </button>
            </div>
            @for (group of dashboard().groupSummaries; track group.groupId) {
              <a class="group-pill" [routerLink]="['/groups', group.groupId]">
                <span class="avatar group-avatar">{{ group.name.slice(0, 1) }}</span>
                <span>
                  <strong>{{ group.name }}</strong>
                  <small>{{ groupText(group.netUsdMicros) }}</small>
                </span>
              </a>
            }
          </section>

          <mat-tab-group animationDuration="160ms">
            <mat-tab label="Friends">
              <mat-nav-list class="entity-list">
                @for (friend of dashboard().friendBalances; track friend.friendId) {
                  <a mat-list-item>
                    <span matListItemIcon class="avatar">{{ initials(friend.displayName) }}</span>
                    <span matListItemTitle>{{ friend.displayName }}</span>
                    <span matListItemLine>{{ friend.phoneNumber }}</span>
                    <span class="amount" [class.positive]="friend.netUsdMicros > 0" [class.negative]="friend.netUsdMicros < 0">
                      {{ balanceText(friend.netUsdMicros) }}
                    </span>
                  </a>
                  <mat-divider />
                } @empty {
                  <p class="empty-state">Add friends by phone number to start splitting expenses.</p>
                }
              </mat-nav-list>
            </mat-tab>

            <mat-tab label="Groups">
              <mat-nav-list class="entity-list">
                @for (group of dashboard().groupSummaries; track group.groupId) {
                  <a mat-list-item [routerLink]="['/groups', group.groupId]">
                    <span matListItemIcon class="avatar group-avatar">{{ group.name.slice(0, 1) }}</span>
                    <span matListItemTitle>{{ group.name }}</span>
                    <span matListItemLine>{{ group.memberIds.length }} members</span>
                    <span class="amount" [class.positive]="group.netUsdMicros > 0" [class.negative]="group.netUsdMicros < 0">
                      {{ groupText(group.netUsdMicros) }}
                    </span>
                  </a>
                  <mat-divider />
                }
              </mat-nav-list>
            </mat-tab>

            <mat-tab>
              <ng-template mat-tab-label>
                Activity
                @if (dashboard().pendingApprovalCount > 0) {
                  <span class="tab-badge" [matBadge]="dashboard().pendingApprovalCount"></span>
                }
              </ng-template>
              <mat-list class="activity-list">
                @for (item of dashboard().recentActivity; track item.eventId) {
                  <mat-list-item>
                    <mat-icon matListItemIcon>{{ iconFor(item.eventType) }}</mat-icon>
                    <span matListItemTitle>{{ item.summary }}</span>
                    <span matListItemLine>
                      {{ item.createdAt | date: 'MMM d, h:mm a' }}
                      @if (item.amountUsdMicros) {
                        · {{ money(item.amountUsdMicros) }}
                      }
                    </span>
                  </mat-list-item>
                } @empty {
                  <p class="empty-state">Expenses and payments will appear here as event-log entries.</p>
                }
              </mat-list>
            </mat-tab>
          </mat-tab-group>
        </section>

        <aside class="desktop-activity">
          <h2>Event log</h2>
          @for (item of dashboard().recentActivity; track item.eventId) {
            <div class="activity-card">
              <mat-icon>{{ iconFor(item.eventType) }}</mat-icon>
              <div>
                <strong>{{ item.summary }}</strong>
                <p>
                  <span class="event-tag" [class.group-event]="item.tag === 'group'">{{ tagText(item.tag) }}</span>
                  {{ item.createdAt | date: 'MMM d, h:mm a' }}
                  @if (item.amountUsdMicros) {
                    · {{ money(item.amountUsdMicros) }}
                  }
                </p>
              </div>
            </div>
          } @empty {
            <p class="empty-state">No events yet.</p>
          }
        </aside>
      </section>
    </main>
  `,
  styles: [
    `
      .dashboard-page {
        min-height: 100vh;
        background:
          radial-gradient(circle at 20% 0%, #dff5ff 0, transparent 30rem),
          var(--dutch-page);
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        background: rgba(255, 255, 255, 0.92);
        border-bottom: 1px solid var(--dutch-border);
        backdrop-filter: blur(16px);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
        font-size: 1.25rem;
        font-weight: 800;
      }

      .brand-mark,
      .avatar {
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        background: var(--dutch-primary-soft);
        color: var(--dutch-primary);
        font-weight: 800;
      }

      .brand-mark {
        width: 2rem;
        height: 2rem;
      }

      .spacer {
        flex: 1;
      }

      .sync-pill {
        margin-right: 0.5rem;
        border-radius: 999px;
        background: #ecfdf5;
        color: #047857;
        padding: 0.25rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 700;
      }

      .sync-pill.pending {
        background: #fffbeb;
        color: #b45309;
      }

      .dashboard-grid {
        display: grid;
        gap: 1rem;
        max-width: 76rem;
        margin: 0 auto;
        padding: 1rem;
      }

      .balance-panel,
      .lists-panel,
      .desktop-activity {
        border: 1px solid var(--dutch-border);
        border-radius: 0.5rem;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 18px 50px rgb(15 23 42 / 0.08);
      }

      .balance-panel {
        padding: 1rem;
      }

      .eyebrow {
        margin: 0 0 0.5rem;
        color: var(--dutch-muted);
        font-size: 0.8125rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        color: #0f172a;
        font-size: clamp(2rem, 7vw, 3.5rem);
        line-height: 1.05;
      }

      .balance-row,
      .quick-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1rem;
      }

      .currency-field {
        width: min(100%, 15rem);
        margin-top: 1rem;
      }

      .positive {
        color: var(--dutch-positive);
      }

      .negative {
        color: var(--dutch-negative);
      }

      .entity-list {
        padding: 0.25rem 0;
      }

      .group-overview {
        display: grid;
        gap: 0.5rem;
        border-bottom: 1px solid var(--dutch-border);
        padding: 1rem;
      }

      .section-title {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
      }

      .section-title h2 {
        margin: 0;
      }

      .section-title span {
        color: var(--dutch-muted);
        font-size: 0.8125rem;
        font-weight: 700;
      }

      .section-title button {
        color: var(--dutch-primary);
      }

      .group-pill {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 0.75rem;
        border: 1px solid var(--dutch-border);
        border-radius: 0.5rem;
        padding: 0.75rem;
        color: inherit;
        text-decoration: none;
      }

      .group-pill small {
        display: block;
        color: var(--dutch-muted);
        margin-top: 0.125rem;
      }

      .entity-list a {
        min-height: 4.5rem;
      }

      .avatar {
        width: 2.5rem;
        height: 2.5rem;
      }

      .group-avatar {
        background: #dff5ff;
      }

      .amount {
        margin-left: auto;
        font-weight: 800;
        white-space: nowrap;
      }

      .empty-state {
        margin: 1rem;
        color: var(--dutch-muted);
      }

      .tab-badge {
        margin-left: 0.75rem;
      }

      .desktop-activity {
        display: none;
        padding: 1rem;
      }

      .desktop-activity h2 {
        margin: 0 0 1rem;
      }

      .activity-card {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.75rem;
        border-bottom: 1px solid var(--dutch-border);
        padding: 0.875rem 0;
      }

      .activity-card p {
        margin: 0.125rem 0 0;
        color: var(--dutch-muted);
      }

      .event-tag {
        display: inline-block;
        margin-right: 0.35rem;
        border-radius: 999px;
        background: #eef2ff;
        color: #3730a3;
        padding: 0.1rem 0.4rem;
        font-size: 0.6875rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .event-tag.group-event {
        background: var(--dutch-primary-soft);
        color: var(--dutch-primary);
      }

      @media (min-width: 900px) {
        .dashboard-grid {
          grid-template-columns: minmax(18rem, 1fr) minmax(24rem, 1.4fr) minmax(17rem, 0.9fr);
          align-items: start;
        }

        .balance-panel {
          position: sticky;
          top: 5rem;
        }

        .desktop-activity {
          display: block;
        }
      }
    `,
  ],
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
