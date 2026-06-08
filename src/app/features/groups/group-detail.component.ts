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
  templateUrl: './group-detail.component.html',
  styleUrl: './group-detail.component.scss',
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
