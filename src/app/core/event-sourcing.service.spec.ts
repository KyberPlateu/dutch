import { TestBed } from '@angular/core/testing';
import { firstValueFrom, skip } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_USER_ID,
  DUTCH_EVENT_STORE,
  DUTCH_SYNC_TRANSPORT,
  DomainEvent,
  EventStore,
  EventSourcingService,
  SyncStatus,
  parseAmountToMinorUnits,
  splitEqualMinorUnits,
} from './event-sourcing.service';

class MemoryEventStore implements EventStore {
  private readonly events = new Map<string, DomainEvent>();

  async loadEvents(): Promise<DomainEvent[]> {
    return [...this.events.values()];
  }

  async upsertEvent(event: DomainEvent): Promise<void> {
    this.events.set(event.eventId, event);
  }

  async updateSyncStatus(
    eventId: string,
    syncStatus: SyncStatus,
    retryCount: number,
    lastSyncError?: string,
  ): Promise<void> {
    const event = this.events.get(eventId);

    if (event) {
      this.events.set(eventId, { ...event, syncStatus, retryCount, lastSyncError });
    }
  }
}

describe('EventSourcingService', () => {
  let service: EventSourcingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EventSourcingService,
        { provide: DUTCH_EVENT_STORE, useClass: MemoryEventStore },
        {
          provide: DUTCH_SYNC_TRANSPORT,
          useValue: { pushEvents: async (events: DomainEvent[]) => ({ acceptedEventIds: events.map((event) => event.eventId) }) },
        },
      ],
    });

    service = TestBed.inject(EventSourcingService);
  });

  it('splits a 10.00 bill three ways without losing a cent', () => {
    const split = splitEqualMinorUnits(1000, ['a', 'b', 'c']);

    expect(split.map((row) => row.amountMinor)).toEqual([334, 333, 333]);
    expect(split.reduce((sum, row) => sum + row.amountMinor, 0)).toBe(1000);
  });

  it('rejects expenses when total paid differs from total split', async () => {
    await expect(
      service.createExpense({
        description: 'Dinner',
        currency: 'USD',
        transactionAt: new Date().toISOString(),
        fxRateToUsd: '1',
        groupId: 'group-trip',
        paidBy: [{ userId: CURRENT_USER_ID, amountMinor: 1000 }],
        owedBy: [
          { userId: CURRENT_USER_ID, amountMinor: 500 },
          { userId: 'user-bob', amountMinor: 499 },
        ],
      }),
    ).rejects.toThrow('Total paid must equal total split.');
  });

  it('stores non-USD expenses with a decimal FX rate and integer USD micros', async () => {
    const event = await service.createExpense({
      groupId: 'group-trip',
      description: 'Cafe',
      currency: 'EUR',
      transactionAt: new Date().toISOString(),
      fxRateToUsd: '1.083456',
      paidBy: [{ userId: CURRENT_USER_ID, amountMinor: 1234 }],
      owedBy: [
        { userId: CURRENT_USER_ID, amountMinor: 617 },
        { userId: 'user-bob', amountMinor: 617 },
      ],
    });

    expect(event.payload.fxRateToUsd).toBe('1.083456');
    expect(event.payload.amountUsdMicros).toBe(13369847);
    expect(Number.isInteger(event.payload.amountUsdMicros)).toBe(true);
  });

  it('does not change balances for initiated payments until approval', async () => {
    await service.createExpense({
      groupId: 'group-trip',
      description: 'Tickets',
      currency: 'USD',
      transactionAt: new Date().toISOString(),
      fxRateToUsd: '1',
      paidBy: [{ userId: CURRENT_USER_ID, amountMinor: 10000 }],
      owedBy: [
        { userId: CURRENT_USER_ID, amountMinor: 5000 },
        { userId: 'user-bob', amountMinor: 5000 },
      ],
    });

    const initialBalances = await firstValueFrom(service.balances$.pipe(skip(0)));
    expect(initialBalances).toEqual([
      {
        groupId: 'group-trip',
        fromUserId: 'user-bob',
        toUserId: CURRENT_USER_ID,
        amountUsdMicros: 50_000_000,
      },
    ]);

    const payment = await service.initiatePayment({
      groupId: 'group-trip',
      payerId: 'user-bob',
      payeeId: CURRENT_USER_ID,
      amountUsdMicros: 50_000_000,
    });
    const afterInitiation = await firstValueFrom(service.balances$);

    expect(afterInitiation).toEqual(initialBalances);

    await service.approvePayment({
      groupId: 'group-trip',
      settlementId: payment.payload.settlementId,
      approvedBy: CURRENT_USER_ID,
    });
    const afterApproval = await firstValueFrom(service.balances$);

    expect(afterApproval).toEqual([]);
  });

  it('marks accepted events as synced idempotently', async () => {
    await service.createExpense({
      groupId: 'group-trip',
      description: 'Snacks',
      currency: 'USD',
      transactionAt: new Date().toISOString(),
      fxRateToUsd: '1',
      paidBy: [{ userId: CURRENT_USER_ID, amountMinor: 300 }],
      owedBy: [
        { userId: CURRENT_USER_ID, amountMinor: 100 },
        { userId: 'user-bob', amountMinor: 200 },
      ],
    });

    await service.syncPendingEvents();
    await service.syncPendingEvents();

    const state = await firstValueFrom(service.syncState$);
    expect(state.pendingEvents).toBe(0);
  });

  it('adds friends by phone number and projects them into the dashboard', async () => {
    await service.addFriend({ displayName: 'Maya Chen', phoneNumber: '+1 (555) 010-9999' });

    const dashboard = await firstValueFrom(service.dashboard$);

    expect(dashboard.friendBalances.some((friend) => friend.displayName === 'Maya Chen')).toBe(true);
  });

  it('creates groups and records the creation as a tagged group event', async () => {
    const event = await service.createGroup({
      name: 'Weekend Cabin',
      defaultCurrency: 'USD',
      memberIds: [CURRENT_USER_ID, 'user-bob'],
    });

    const groups = await firstValueFrom(service.groups$);
    const activity = await firstValueFrom(service.activityForGroup$(event.groupId));

    expect(groups.some((group) => group.groupId === event.groupId)).toBe(true);
    expect(activity[0]).toMatchObject({
      eventType: 'GROUP_CREATED',
      tag: 'group',
    });
  });

  it('updates groups and records member CRUD as tagged group events', async () => {
    await service.updateGroup({
      groupId: 'group-trip',
      name: 'Europe Reunion',
      defaultCurrency: 'GBP',
    });
    await service.addGroupMember({ groupId: 'group-trip', friendId: 'user-diana' });
    await service.removeGroupMember({ groupId: 'group-trip', friendId: 'user-bob' });

    const group = (await firstValueFrom(service.groups$)).find(
      (item) => item.groupId === 'group-trip',
    );
    const activity = await firstValueFrom(service.activityForGroup$('group-trip'));

    expect(group).toMatchObject({
      name: 'Europe Reunion',
      defaultCurrency: 'GBP',
      memberIds: [CURRENT_USER_ID, 'user-charlie', 'user-diana'],
    });
    expect(activity.slice(0, 3).every((item) => item.tag === 'group')).toBe(true);
    expect(activity.map((item) => item.eventType)).toEqual([
      'GROUP_MEMBER_REMOVED',
      'GROUP_MEMBER_ADDED',
      'GROUP_UPDATED',
    ]);
  });

  it('shows newly added group expenses in the group activity feed', async () => {
    const event = await service.createExpense({
      groupId: 'group-trip',
      description: 'Dinner in Berlin',
      currency: 'EUR',
      transactionAt: new Date().toISOString(),
      fxRateToUsd: '1.08',
      paidBy: [{ userId: CURRENT_USER_ID, amountMinor: 15000 }],
      owedBy: [
        { userId: CURRENT_USER_ID, amountMinor: 5000 },
        { userId: 'user-bob', amountMinor: 5000 },
        { userId: 'user-charlie', amountMinor: 5000 },
      ],
    });

    const expenses = await firstValueFrom(service.expensesForGroup$('group-trip'));
    const activity = await firstValueFrom(service.activityForGroup$('group-trip'));

    expect(expenses[0].expenseId).toBe(event.payload.expenseId);
    expect(activity[0].summary).toContain('Dinner in Berlin');
  });

  it('rejects over-precise currency input instead of silently rounding', () => {
    expect(() => parseAmountToMinorUnits('1.005', 'USD')).toThrow(
      'USD supports 2 decimal places.',
    );
  });

  it('rejects payment approval from anyone except the payee', async () => {
    await service.createExpense({
      groupId: 'group-trip',
      description: 'Hotel',
      currency: 'USD',
      transactionAt: new Date().toISOString(),
      fxRateToUsd: '1',
      paidBy: [{ userId: CURRENT_USER_ID, amountMinor: 10000 }],
      owedBy: [
        { userId: CURRENT_USER_ID, amountMinor: 5000 },
        { userId: 'user-bob', amountMinor: 5000 },
      ],
    });
    const payment = await service.initiatePayment({
      groupId: 'group-trip',
      payerId: 'user-bob',
      payeeId: CURRENT_USER_ID,
      amountUsdMicros: 50_000_000,
    });

    await expect(
      service.approvePayment({
        groupId: 'group-trip',
        settlementId: payment.payload.settlementId,
        approvedBy: 'user-bob',
      }),
    ).rejects.toThrow('Only the payment recipient can approve or reject this settlement.');
  });

  it('recovers interrupted syncing events as retryable on startup', async () => {
    const store = new MemoryEventStore();
    await store.upsertEvent({
      eventId: '01J00000000000000000000000',
      groupId: 'group-trip',
      eventType: 'GROUP_MEMBER_ADDED',
      payload: { friendId: 'user-diana' },
      createdAt: new Date().toISOString(),
      clientId: 'test',
      syncStatus: 'syncing',
      retryCount: 0,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EventSourcingService,
        { provide: DUTCH_EVENT_STORE, useValue: store },
        {
          provide: DUTCH_SYNC_TRANSPORT,
          useValue: { pushEvents: async () => ({ acceptedEventIds: [] }) },
        },
      ],
    });

    const recovered = TestBed.inject(EventSourcingService);
    const state = await firstValueFrom(recovered.syncState$.pipe(skip(1)));

    expect(state.pendingEvents).toBe(1);
  });
});
