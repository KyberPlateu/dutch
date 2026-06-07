import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  ActivityFeedItem,
  Balance,
  CURRENT_USER_ID,
  EventSourcingService,
  Friend,
  Group,
} from '../../core/event-sourcing.service';
import { CurrencyDisplayService } from '../../core/currency-display.service';
import { GroupEditorDialogComponent } from './group-editor-dialog.component';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatDividerModule,
    MatIconModule,
    MatListModule,
    MatToolbarModule,
    RouterLink,
  ],
  template: `
    <main class="group-page">
      <mat-toolbar class="topbar">
        <a mat-icon-button routerLink="/" aria-label="Back to dashboard">
          <mat-icon>arrow_back</mat-icon>
        </a>
        <span>{{ group()?.name ?? 'Group' }}</span>
        <span class="spacer"></span>
        <a mat-flat-button color="primary" [routerLink]="['/groups', groupId, 'expenses', 'new']">
          <mat-icon>add</mat-icon>
          Add expense
        </a>
      </mat-toolbar>

      <section class="group-grid">
        <header class="hero-panel">
          <p class="eyebrow">Active group</p>
          <div class="hero-title">
            <h1>{{ group()?.name ?? 'Group' }}</h1>
            <button mat-stroked-button type="button" (click)="openManageGroup()">
              <mat-icon>manage_accounts</mat-icon>
              Manage group
            </button>
          </div>
          <mat-chip-set>
            @for (member of members(); track member.friendId) {
              <mat-chip>
                <span class="avatar">{{ initials(member.displayName) }}</span>
                {{ member.displayName }}
              </mat-chip>
            }
          </mat-chip-set>
        </header>

        <section class="panel">
          <h2>Balances</h2>
          <mat-list>
            @for (balance of balances(); track balanceKey(balance)) {
              <mat-list-item>
                <mat-icon matListItemIcon [class.negative]="balance.fromUserId === currentUserId">
                  {{ balance.fromUserId === currentUserId ? 'trending_down' : 'trending_up' }}
                </mat-icon>
                <span matListItemTitle>{{ balanceText(balance) }}</span>
                <span matListItemLine>{{ money(balance.amountUsdMicros) }}</span>
              </mat-list-item>
            } @empty {
              <p class="empty-state">This group is settled up.</p>
            }
          </mat-list>
        </section>

        <section class="panel activity-panel">
          <h2>Activity feed</h2>
          @for (item of activity(); track item.eventId) {
            <article class="activity-row">
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
            </article>
          } @empty {
            <p class="empty-state">Add an expense to start the group ledger.</p>
          }
        </section>
      </section>
    </main>
  `,
  styles: [
    `
      .group-page {
        min-height: 100vh;
        background:
          radial-gradient(circle at 20% 0%, #dff5ff 0, transparent 28rem),
          var(--dutch-page);
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        background: rgba(255, 255, 255, 0.94);
        border-bottom: 1px solid var(--dutch-border);
        backdrop-filter: blur(16px);
      }

      .spacer {
        flex: 1;
      }

      .group-grid {
        display: grid;
        gap: 1rem;
        max-width: 72rem;
        margin: 0 auto;
        padding: 1rem;
      }

      .hero-panel,
      .panel {
        border: 1px solid var(--dutch-border);
        border-radius: 0.5rem;
        background: rgba(255, 255, 255, 0.95);
        box-shadow: 0 18px 50px rgb(15 23 42 / 0.08);
      }

      .hero-panel {
        padding: 1rem;
      }

      .eyebrow {
        margin: 0 0 0.35rem;
        color: var(--dutch-muted);
        font-size: 0.8125rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      h1,
      h2 {
        margin: 0;
      }

      h1 {
        font-size: clamp(2rem, 6vw, 3.4rem);
      }

      .hero-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      h2 {
        padding: 1rem 1rem 0;
      }

      .avatar {
        display: inline-grid;
        place-items: center;
        width: 1.5rem;
        height: 1.5rem;
        margin-right: 0.375rem;
        border-radius: 999px;
        background: var(--dutch-primary-soft);
        color: var(--dutch-primary);
        font-size: 0.75rem;
        font-weight: 800;
      }

      .negative {
        color: var(--dutch-negative);
      }

      .empty-state {
        margin: 1rem;
        color: var(--dutch-muted);
      }

      .activity-panel {
        padding-bottom: 0.5rem;
      }

      .activity-row {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.75rem;
        margin: 0 1rem;
        border-bottom: 1px solid var(--dutch-border);
        padding: 0.875rem 0;
      }

      .activity-row p {
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

      @media (min-width: 820px) {
        .group-grid {
          grid-template-columns: minmax(18rem, 0.8fr) minmax(28rem, 1.2fr);
        }

        .hero-panel {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class GroupDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly eventService = inject(EventSourcingService);
  private readonly currencyDisplay = inject(CurrencyDisplayService);
  private readonly dialog = inject(MatDialog);

  protected readonly currentUserId = CURRENT_USER_ID;
  protected readonly groupId = this.route.snapshot.paramMap.get('groupId') ?? '';
  private readonly groups = toSignal(this.eventService.groups$, { initialValue: [] as Group[] });
  private readonly groupMembers = toSignal(this.eventService.groupMembers$, {
    initialValue: {} as Record<string, Friend[]>,
  });
  private readonly allBalances = toSignal(this.eventService.balances$, {
    initialValue: [] as Balance[],
  });
  private readonly allActivity = toSignal(this.eventService.activityFeed$, {
    initialValue: [] as ActivityFeedItem[],
  });

  protected readonly group = computed(() =>
    this.groups().find((group) => group.groupId === this.groupId),
  );
  protected readonly members = computed(() => this.groupMembers()[this.groupId] ?? []);
  protected readonly balances = computed(() =>
    this.allBalances().filter((balance) => balance.groupId === this.groupId),
  );
  protected readonly activity = computed(() =>
    this.allActivity().filter((item) => item.groupId === this.groupId),
  );

  protected balanceText(balance: Balance): string {
    return `${this.nameFor(balance.fromUserId)} owes ${this.nameFor(balance.toUserId)}`;
  }

  protected balanceKey(balance: Balance): string {
    return `${balance.groupId}-${balance.fromUserId}-${balance.toUserId}`;
  }

  protected money(amountUsdMicros: number): string {
    return this.currencyDisplay.formatUsdMicros(amountUsdMicros);
  }

  protected nameFor(userId: string): string {
    return this.members().find((member) => member.friendId === userId)?.displayName ?? userId;
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  protected iconFor(eventType: string): string {
    if (eventType.startsWith('GROUP')) {
      return 'groups';
    }

    return eventType.startsWith('PAYMENT') ? 'payments' : 'receipt_long';
  }

  protected tagText(tag: string): string {
    return tag === 'group' ? 'Group event' : tag;
  }

  protected openManageGroup(): void {
    this.dialog.open(GroupEditorDialogComponent, {
      autoFocus: 'first-tabbable',
      width: 'min(34rem, 94vw)',
      data: { groupId: this.groupId },
    });
  }
}
