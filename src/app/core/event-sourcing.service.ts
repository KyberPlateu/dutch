import { Inject, Injectable, InjectionToken } from '@angular/core';
import Decimal from 'decimal.js';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { BehaviorSubject, map } from 'rxjs';
import { monotonicFactory, ulid } from 'ulid';

export type EventType =
  | 'FRIEND_ADDED'
  | 'FRIEND_UPDATED'
  | 'FRIEND_ARCHIVED'
  | 'GROUP_CREATED'
  | 'GROUP_UPDATED'
  | 'GROUP_MEMBER_ADDED'
  | 'GROUP_MEMBER_REMOVED'
  | 'EXPENSE_CREATED'
  | 'EXPENSE_UPDATED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED';

export type SplitMode = 'equal' | 'exact' | 'percent';
export type SyncStatus = 'local' | 'syncing' | 'synced' | 'failed';

export interface MoneyAllocation {
  userId: string;
  amountMinor: number;
  amountUsdMicros: number;
}

export interface Friend {
  friendId: string;
  phoneNumber: string;
  displayName: string;
  avatarInitials: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Group {
  groupId: string;
  name: string;
  memberIds: string[];
  defaultCurrency: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface FriendAddedPayload {
  friendId: string;
  phoneNumber: string;
  displayName: string;
  avatarInitials: string;
}

export interface GroupCreatedPayload {
  groupId: string;
  name: string;
  memberIds: string[];
  defaultCurrency: string;
}

export interface GroupUpdatedPayload {
  name?: string;
  defaultCurrency?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
}

export interface GroupMemberChangedPayload {
  friendId: string;
}

export interface ExpenseCreatedPayload {
  expenseId: string;
  description: string;
  currency: string;
  originalAmountMinor: number;
  amountUsdMicros: number;
  fxRateToUsd: string;
  transactionAt: string;
  paidBy: MoneyAllocation[];
  owedBy: MoneyAllocation[];
}

export interface PaymentInitiatedPayload {
  settlementId: string;
  payerId: string;
  payeeId: string;
  currency: string;
  originalAmountMinor: number;
  fxRateToUsd: string;
  amountUsdMicros: number;
  note?: string;
}

export interface PaymentResolvedPayload {
  settlementId: string;
  approvedBy: string;
}

export type EventPayload =
  | FriendAddedPayload
  | GroupCreatedPayload
  | GroupUpdatedPayload
  | GroupMemberChangedPayload
  | ExpenseCreatedPayload
  | PaymentInitiatedPayload
  | PaymentResolvedPayload;

export interface DomainEvent<TPayload extends EventPayload = EventPayload> {
  eventId: string;
  groupId: string;
  eventType: EventType;
  payload: TPayload;
  createdAt: string;
  clientId: string;
  syncStatus: SyncStatus;
  retryCount: number;
  lastSyncError?: string;
}

export interface Balance {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountUsdMicros: number;
}

export interface PendingSettlement {
  groupId: string;
  settlementId: string;
  payerId: string;
  payeeId: string;
  amountUsdMicros: number;
  createdAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface Settlement extends PendingSettlement {
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface GroupExpenseSummary {
  groupId: string;
  expenseId: string;
  description: string;
  currency: string;
  originalAmountMinor: number;
  amountUsdMicros: number;
  fxRateToUsd: string;
  transactionAt: string;
  createdAt: string;
  paidBy: MoneyAllocation[];
  owedBy: MoneyAllocation[];
}

export interface ActivityFeedItem {
  eventId: string;
  groupId: string;
  eventType: EventType;
  tag: 'friend' | 'group' | 'expense' | 'payment';
  createdAt: string;
  summary: string;
  amountUsdMicros?: number;
  currency?: string;
  originalAmountMinor?: number;
  refs: {
    expenseId?: string;
    settlementId?: string;
    friendId?: string;
    groupId?: string;
  };
}

export interface FriendBalanceSummary {
  friendId: string;
  displayName: string;
  phoneNumber: string;
  netUsdMicros: number;
}

export interface GroupBalanceSummary {
  groupId: string;
  name: string;
  memberIds: string[];
  youOweUsdMicros: number;
  youAreOwedUsdMicros: number;
  netUsdMicros: number;
  latestActivity?: ActivityFeedItem;
}

export interface DashboardAggregate {
  totalYouOweUsdMicros: number;
  totalYouAreOwedUsdMicros: number;
  pendingApprovalCount: number;
  groupCount: number;
  friendCount: number;
  recentActivity: ActivityFeedItem[];
  friendBalances: FriendBalanceSummary[];
  groupSummaries: GroupBalanceSummary[];
}

export interface CreateExpenseInput {
  groupId: string;
  description: string;
  currency: string;
  transactionAt: string;
  fxRateToUsd: string;
  paidBy: Array<{ userId: string; amountMinor: number }>;
  owedBy: Array<{ userId: string; amountMinor: number }>;
}

export interface AddFriendInput {
  phoneNumber: string;
  displayName: string;
}

export interface CreateGroupInput {
  groupId?: string;
  name: string;
  memberIds: string[];
  defaultCurrency?: string;
}

export interface UpdateGroupInput {
  groupId: string;
  name?: string;
  defaultCurrency?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
}

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingEvents: number;
  lastError?: string;
}

export interface EventStore {
  loadEvents(): Promise<DomainEvent[]>;
  upsertEvent(event: DomainEvent): Promise<void>;
  updateSyncStatus(
    eventId: string,
    syncStatus: SyncStatus,
    retryCount: number,
    lastSyncError?: string,
  ): Promise<void>;
}

export interface SyncTransport {
  pushEvents(events: DomainEvent[]): Promise<{ acceptedEventIds: string[] }>;
}

interface DutchDb extends DBSchema {
  events: {
    key: string;
    value: DomainEvent;
    indexes: { 'by-created-at': string; 'by-sync-status': SyncStatus };
  };
}

const USD_MICROS_PER_UNIT = 1_000_000;
const DEFAULT_CLIENT_ID_KEY = 'dutch.clientId';
const nextUlid = monotonicFactory();
export const CURRENT_USER_ID = 'user-alice';
export const GLOBAL_GROUP_ID = '__global__';
const MINOR_UNITS: Record<string, number> = {
  BHD: 3,
  CLP: 0,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
  USD: 2,
};

const SEED_FRIENDS: Friend[] = [
  {
    friendId: CURRENT_USER_ID,
    phoneNumber: '+15550100001',
    displayName: 'Alice',
    avatarInitials: 'AL',
    status: 'ACTIVE',
  },
  {
    friendId: 'user-bob',
    phoneNumber: '+15550100002',
    displayName: 'Bob',
    avatarInitials: 'BO',
    status: 'ACTIVE',
  },
  {
    friendId: 'user-charlie',
    phoneNumber: '+15550100003',
    displayName: 'Charlie',
    avatarInitials: 'CH',
    status: 'ACTIVE',
  },
  {
    friendId: 'user-diana',
    phoneNumber: '+15550100004',
    displayName: 'Diana',
    avatarInitials: 'DI',
    status: 'ACTIVE',
  },
];

const SEED_GROUPS: Group[] = [
  {
    groupId: 'group-trip',
    name: "Europe Trip '24",
    memberIds: [CURRENT_USER_ID, 'user-bob', 'user-charlie'],
    defaultCurrency: 'EUR',
    status: 'ACTIVE',
  },
  {
    groupId: 'group-home',
    name: 'Roommates',
    memberIds: [CURRENT_USER_ID, 'user-bob', 'user-diana'],
    defaultCurrency: 'USD',
    status: 'ACTIVE',
  },
];

export const DUTCH_EVENT_STORE = new InjectionToken<EventStore>('Dutch event store', {
  providedIn: 'root',
  factory: () => createDefaultEventStore(),
});

export const DUTCH_SYNC_TRANSPORT = new InjectionToken<SyncTransport>(
  'Dutch sync transport',
  {
    providedIn: 'root',
    factory: () => new NoopSyncTransport(),
  },
);

@Injectable({ providedIn: 'root' })
export class EventSourcingService {
  private readonly eventsSubject = new BehaviorSubject<DomainEvent[]>([]);
  private readonly balancesSubject = new BehaviorSubject<Balance[]>([]);
  private readonly pendingSettlementsSubject = new BehaviorSubject<PendingSettlement[]>([]);
  private readonly friendsSubject = new BehaviorSubject<Friend[]>(SEED_FRIENDS);
  private readonly groupsSubject = new BehaviorSubject<Group[]>(SEED_GROUPS);
  private readonly groupMembersSubject = new BehaviorSubject<Record<string, Friend[]>>({});
  private readonly groupExpensesSubject = new BehaviorSubject<Record<string, GroupExpenseSummary[]>>({});
  private readonly activityFeedSubject = new BehaviorSubject<ActivityFeedItem[]>([]);
  private readonly settlementsSubject = new BehaviorSubject<Settlement[]>([]);
  private readonly dashboardSubject = new BehaviorSubject<DashboardAggregate>({
    totalYouOweUsdMicros: 0,
    totalYouAreOwedUsdMicros: 0,
    pendingApprovalCount: 0,
    groupCount: SEED_GROUPS.length,
    friendCount: SEED_FRIENDS.filter((friend) => friend.friendId !== CURRENT_USER_ID).length,
    recentActivity: [],
    friendBalances: [],
    groupSummaries: [],
  });
  private readonly syncStateSubject = new BehaviorSubject<SyncState>({
    online: isOnline(),
    syncing: false,
    pendingEvents: 0,
  });

  private readonly clientId = getOrCreateClientId();
  private readonly ready: Promise<void>;

  readonly events$ = this.eventsSubject.asObservable();
  readonly balances$ = this.balancesSubject.asObservable();
  readonly pendingSettlements$ = this.pendingSettlementsSubject.asObservable();
  readonly friends$ = this.friendsSubject.asObservable();
  readonly groups$ = this.groupsSubject.asObservable();
  readonly groupMembers$ = this.groupMembersSubject.asObservable();
  readonly groupExpenses$ = this.groupExpensesSubject.asObservable();
  readonly activityFeed$ = this.activityFeedSubject.asObservable();
  readonly settlements$ = this.settlementsSubject.asObservable();
  readonly dashboard$ = this.dashboardSubject.asObservable();
  readonly syncState$ = this.syncStateSubject.asObservable();

  constructor(
    @Inject(DUTCH_EVENT_STORE) private readonly eventStore: EventStore,
    @Inject(DUTCH_SYNC_TRANSPORT) private readonly syncTransport: SyncTransport,
  ) {
    this.ready = this.loadEvents();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setOnline(true));
      window.addEventListener('offline', () => this.setOnline(false));
    }
  }

  async addFriend(input: AddFriendInput): Promise<DomainEvent<FriendAddedPayload>> {
    await this.ready;
    const phoneNumber = normalizePhoneNumber(input.phoneNumber);
    const displayName = input.displayName.trim();

    if (!displayName) {
      throw new Error('Friend name is required.');
    }

    if (!isValidPhoneNumber(phoneNumber)) {
      throw new Error('Enter a valid phone number.');
    }

    const existing = this.friendsSubject.value.find((friend) => friend.phoneNumber === phoneNumber);

    if (existing) {
      throw new Error('That phone number is already connected.');
    }

    const event: DomainEvent<FriendAddedPayload> = {
      eventId: nextUlid(),
      groupId: GLOBAL_GROUP_ID,
      eventType: 'FRIEND_ADDED',
      payload: {
        friendId: nextUlid(),
        phoneNumber,
        displayName,
        avatarInitials: initialsFor(displayName),
      },
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  async createGroup(input: CreateGroupInput): Promise<DomainEvent<GroupCreatedPayload>> {
    await this.ready;
    const name = input.name.trim();
    const memberIds = uniqueIds([CURRENT_USER_ID, ...input.memberIds]);
    const groupId = input.groupId ?? nextUlid();

    if (!name) {
      throw new Error('Group name is required.');
    }

    if (this.groupsSubject.value.some((group) => group.groupId === groupId)) {
      throw new Error('Group already exists.');
    }

    const knownFriendIds = new Set(this.friendsSubject.value.map((friend) => friend.friendId));
    const unknownMember = memberIds.find((memberId) => !knownFriendIds.has(memberId));

    if (unknownMember) {
      throw new Error(`Unknown group member: ${unknownMember}`);
    }

    const event: DomainEvent<GroupCreatedPayload> = {
      eventId: nextUlid(),
      groupId,
      eventType: 'GROUP_CREATED',
      payload: {
        groupId,
        name,
        memberIds,
        defaultCurrency: input.defaultCurrency?.toUpperCase() ?? 'USD',
      },
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  async updateGroup(input: UpdateGroupInput): Promise<DomainEvent<GroupUpdatedPayload>> {
    await this.ready;
    const group = this.groupsSubject.value.find((item) => item.groupId === input.groupId);

    if (!group) {
      throw new Error('Group not found.');
    }

    const name = input.name?.trim();
    const defaultCurrency = input.defaultCurrency?.toUpperCase();
    const payload: GroupUpdatedPayload = {};

    if (name !== undefined) {
      if (!name) {
        throw new Error('Group name is required.');
      }

      if (name !== group.name) {
        payload.name = name;
      }
    }

    if (defaultCurrency !== undefined && defaultCurrency !== group.defaultCurrency) {
      currencyMinorUnits(defaultCurrency);
      payload.defaultCurrency = defaultCurrency;
    }

    if (input.status !== undefined && input.status !== group.status) {
      payload.status = input.status;
    }

    if (Object.keys(payload).length === 0) {
      throw new Error('No group changes to save.');
    }

    const event: DomainEvent<GroupUpdatedPayload> = {
      eventId: nextUlid(),
      groupId: input.groupId,
      eventType: 'GROUP_UPDATED',
      payload,
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  async addGroupMember(input: {
    groupId: string;
    friendId: string;
  }): Promise<DomainEvent<GroupMemberChangedPayload>> {
    await this.ready;
    const group = this.groupsSubject.value.find((item) => item.groupId === input.groupId);

    if (!group) {
      throw new Error('Group not found.');
    }

    if (!this.friendsSubject.value.some((friend) => friend.friendId === input.friendId)) {
      throw new Error('Friend not found.');
    }

    if (group.memberIds.includes(input.friendId)) {
      throw new Error('Friend is already in this group.');
    }

    const event: DomainEvent<GroupMemberChangedPayload> = {
      eventId: nextUlid(),
      groupId: input.groupId,
      eventType: 'GROUP_MEMBER_ADDED',
      payload: { friendId: input.friendId },
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  async removeGroupMember(input: {
    groupId: string;
    friendId: string;
  }): Promise<DomainEvent<GroupMemberChangedPayload>> {
    await this.ready;
    const group = this.groupsSubject.value.find((item) => item.groupId === input.groupId);

    if (!group) {
      throw new Error('Group not found.');
    }

    if (input.friendId === CURRENT_USER_ID) {
      throw new Error('The current user cannot be removed from their own group.');
    }

    if (!group.memberIds.includes(input.friendId)) {
      throw new Error('Friend is not in this group.');
    }

    const event: DomainEvent<GroupMemberChangedPayload> = {
      eventId: nextUlid(),
      groupId: input.groupId,
      eventType: 'GROUP_MEMBER_REMOVED',
      payload: { friendId: input.friendId },
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  async createExpense(input: CreateExpenseInput): Promise<DomainEvent<ExpenseCreatedPayload>> {
    await this.ready;
    const currency = input.currency.toUpperCase();
    const totalPaidMinor = sumMinor(input.paidBy);
    const totalOwedMinor = sumMinor(input.owedBy);
    const group = this.groupsSubject.value.find((item) => item.groupId === input.groupId);

    if (totalPaidMinor <= 0) {
      throw new Error('Expense total must be greater than zero.');
    }

    if (!group) {
      throw new Error('Group not found.');
    }

    if (totalPaidMinor !== totalOwedMinor) {
      throw new Error('Total paid must equal total split.');
    }

    assertGroupMembers(group, [...input.paidBy, ...input.owedBy].map((row) => row.userId));

    assertValidFxRate(input.fxRateToUsd);
    const amountUsdMicros = minorToUsdMicros(totalPaidMinor, currency, input.fxRateToUsd);

    const paidUsd = allocateUsdMicros(input.paidBy, totalPaidMinor, amountUsdMicros);
    const owedUsd = allocateUsdMicros(input.owedBy, totalOwedMinor, amountUsdMicros);

    const event: DomainEvent<ExpenseCreatedPayload> = {
      eventId: nextUlid(),
      groupId: input.groupId,
      eventType: 'EXPENSE_CREATED',
      payload: {
        expenseId: nextUlid(),
        description: input.description.trim(),
        currency,
        originalAmountMinor: totalPaidMinor,
        amountUsdMicros,
        fxRateToUsd: new Decimal(input.fxRateToUsd).toString(),
        transactionAt: input.transactionAt,
        paidBy: paidUsd,
        owedBy: owedUsd,
      },
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  async initiatePayment(input: {
    groupId: string;
    payerId: string;
    payeeId: string;
    currency?: string;
    originalAmountMinor?: number;
    fxRateToUsd?: string;
    amountUsdMicros: number;
    note?: string;
  }): Promise<DomainEvent<PaymentInitiatedPayload>> {
    await this.ready;
    assertPositiveInteger(input.amountUsdMicros, 'Payment amount');
    const outstanding = this.balancesSubject.value.find(
      (balance) =>
        balance.groupId === input.groupId &&
        balance.fromUserId === input.payerId &&
        balance.toUserId === input.payeeId,
    );

    if (!outstanding || outstanding.amountUsdMicros < input.amountUsdMicros) {
      throw new Error('Payment amount cannot exceed the outstanding balance.');
    }

    const currency = input.currency?.toUpperCase() ?? 'USD';
    const fxRateToUsd = input.fxRateToUsd ?? '1';
    assertValidFxRate(fxRateToUsd);

    const event: DomainEvent<PaymentInitiatedPayload> = {
      eventId: nextUlid(),
      groupId: input.groupId,
      eventType: 'PAYMENT_INITIATED',
      payload: {
        settlementId: nextUlid(),
        payerId: input.payerId,
        payeeId: input.payeeId,
        currency,
        originalAmountMinor:
          input.originalAmountMinor ??
          new Decimal(input.amountUsdMicros)
            .div(USD_MICROS_PER_UNIT)
            .mul(new Decimal(10).pow(currencyMinorUnits(currency)))
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber(),
        fxRateToUsd: new Decimal(fxRateToUsd).toString(),
        amountUsdMicros: input.amountUsdMicros,
        note: input.note?.trim(),
      },
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  async approvePayment(input: {
    groupId: string;
    settlementId: string;
    approvedBy: string;
  }): Promise<DomainEvent<PaymentResolvedPayload>> {
    return this.resolvePayment('PAYMENT_APPROVED', input);
  }

  async rejectPayment(input: {
    groupId: string;
    settlementId: string;
    approvedBy: string;
  }): Promise<DomainEvent<PaymentResolvedPayload>> {
    return this.resolvePayment('PAYMENT_REJECTED', input);
  }

  async syncPendingEvents(): Promise<void> {
    await this.ready;
    const pending = this.eventsSubject
      .value
      .filter((event) => event.syncStatus === 'local' || event.syncStatus === 'failed')
      .sort(compareEvents);

    this.syncStateSubject.next({
      ...this.syncStateSubject.value,
      syncing: true,
      pendingEvents: pending.length,
      lastError: undefined,
    });

    if (pending.length === 0) {
      this.syncStateSubject.next({ ...this.syncStateSubject.value, syncing: false });
      return;
    }

    try {
      for (const event of pending) {
        await this.markEvent(event.eventId, 'syncing', event.retryCount);
      }

      const result = await this.syncTransport.pushEvents(pending);
      const accepted = new Set(result.acceptedEventIds);

      for (const event of pending) {
        if (accepted.has(event.eventId)) {
          await this.markEvent(event.eventId, 'synced', event.retryCount);
        } else {
          await this.markEvent(event.eventId, 'local', event.retryCount);
        }
      }

      this.syncStateSubject.next({
        ...this.syncStateSubject.value,
        syncing: false,
        pendingEvents: this.countPendingEvents(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.';

      for (const event of pending) {
        await this.markEvent(event.eventId, 'failed', event.retryCount + 1, message);
      }

      this.syncStateSubject.next({
        online: isOnline(),
        syncing: false,
        pendingEvents: this.countPendingEvents(),
        lastError: message,
      });
    }
  }

  getRetryDelayMs(event: DomainEvent): number {
    const exponent = Math.min(event.retryCount, 6);
    return 1_000 * 2 ** exponent;
  }

  balancesForGroup$(groupId: string) {
    return this.balances$.pipe(
      map((balances) => balances.filter((balance) => balance.groupId === groupId)),
    );
  }

  expensesForGroup$(groupId: string) {
    return this.groupExpenses$.pipe(map((expenses) => expenses[groupId] ?? []));
  }

  activityForGroup$(groupId: string) {
    return this.activityFeed$.pipe(
      map((activity) => activity.filter((item) => item.groupId === groupId)),
    );
  }

  pendingApprovalsForUser$(userId: string) {
    return this.pendingSettlements$.pipe(
      map((settlements) => settlements.filter((settlement) => settlement.payeeId === userId)),
    );
  }

  private async resolvePayment(
    eventType: 'PAYMENT_APPROVED' | 'PAYMENT_REJECTED',
    input: { groupId: string; settlementId: string; approvedBy: string },
  ): Promise<DomainEvent<PaymentResolvedPayload>> {
    await this.ready;
    const settlement = this.settlementsSubject.value.find(
      (item) => item.settlementId === input.settlementId,
    );

    if (!settlement || settlement.groupId !== input.groupId) {
      throw new Error('Settlement not found.');
    }

    if (settlement.status !== 'PENDING') {
      throw new Error('Settlement is already resolved.');
    }

    if (settlement.payeeId !== input.approvedBy) {
      throw new Error('Only the payment recipient can approve or reject this settlement.');
    }

    const event: DomainEvent<PaymentResolvedPayload> = {
      eventId: nextUlid(),
      groupId: input.groupId,
      eventType,
      payload: {
        settlementId: input.settlementId,
        approvedBy: input.approvedBy,
      },
      createdAt: new Date().toISOString(),
      clientId: this.clientId,
      syncStatus: 'local',
      retryCount: 0,
    };

    await this.appendEvent(event);
    return event;
  }

  private async loadEvents(): Promise<void> {
    const loadedEvents = await this.eventStore.loadEvents();
    const events = loadedEvents
      .map((event) =>
        event.syncStatus === 'syncing'
          ? {
              ...event,
              syncStatus: 'failed' as const,
              retryCount: event.retryCount + 1,
              lastSyncError: 'Recovered after interrupted sync.',
            }
          : event,
      )
      .sort(compareEvents);

    for (const event of events) {
      const loaded = loadedEvents.find((item) => item.eventId === event.eventId);

      if (loaded?.syncStatus === 'syncing') {
        await this.eventStore.updateSyncStatus(
          event.eventId,
          event.syncStatus,
          event.retryCount,
          event.lastSyncError,
        );
      }
    }

    this.eventsSubject.next(events);
    this.project(events);
  }

  private async appendEvent(event: DomainEvent): Promise<void> {
    const next = upsertEvent(this.eventsSubject.value, event);
    await this.eventStore.upsertEvent(event);
    this.eventsSubject.next(next);
    this.project(next);
  }

  private async markEvent(
    eventId: string,
    syncStatus: SyncStatus,
    retryCount: number,
    lastSyncError?: string,
  ): Promise<void> {
    await this.eventStore.updateSyncStatus(eventId, syncStatus, retryCount, lastSyncError);

    const events = this.eventsSubject.value.map((event) =>
      event.eventId === eventId
        ? { ...event, syncStatus, retryCount, lastSyncError }
        : event,
    );

    this.eventsSubject.next(events);
    this.project(events);
  }

  private project(events: DomainEvent[]): void {
    const balances = new Map<string, number>();
    const friends = new Map(SEED_FRIENDS.map((friend) => [friend.friendId, { ...friend }]));
    const groups = new Map(SEED_GROUPS.map((group) => [group.groupId, { ...group }]));
    const groupExpenses: Record<string, GroupExpenseSummary[]> = {};
    const activity: ActivityFeedItem[] = [];
    const settlements = new Map<string, PendingSettlement>();
    const allSettlements = new Map<string, Settlement>();

    for (const event of [...events].sort(compareEvents)) {
      if (event.eventType === 'FRIEND_ADDED') {
        const payload = event.payload as FriendAddedPayload;
        friends.set(payload.friendId, {
          friendId: payload.friendId,
          phoneNumber: payload.phoneNumber,
          displayName: payload.displayName,
          avatarInitials: payload.avatarInitials,
          status: 'ACTIVE',
        });
        activity.push({
          eventId: event.eventId,
          groupId: event.groupId,
          eventType: event.eventType,
          tag: 'friend',
          createdAt: event.createdAt,
          summary: `${payload.displayName} was added as a friend.`,
          refs: { friendId: payload.friendId },
        });
      }

      if (event.eventType === 'GROUP_CREATED') {
        const payload = event.payload as GroupCreatedPayload;
        groups.set(payload.groupId, {
          groupId: payload.groupId,
          name: payload.name,
          memberIds: uniqueIds(payload.memberIds),
          defaultCurrency: payload.defaultCurrency,
          status: 'ACTIVE',
        });
        activity.push({
          eventId: event.eventId,
          groupId: payload.groupId,
          eventType: event.eventType,
          tag: 'group',
          createdAt: event.createdAt,
          summary: `${payload.name} was created.`,
          refs: { groupId: payload.groupId },
        });
      }

      if (event.eventType === 'GROUP_UPDATED') {
        const group = groups.get(event.groupId);
        const payload = event.payload as GroupUpdatedPayload;

        if (group) {
          const previousName = group.name;
          group.name = payload.name ?? group.name;
          group.defaultCurrency = payload.defaultCurrency ?? group.defaultCurrency;
          group.status = payload.status ?? group.status;
          activity.push({
            eventId: event.eventId,
            groupId: event.groupId,
            eventType: event.eventType,
            tag: 'group',
            createdAt: event.createdAt,
            summary:
              payload.name && payload.name !== previousName
                ? `${previousName} was renamed to ${payload.name}.`
                : `${group.name} settings were updated.`,
            refs: { groupId: group.groupId },
          });
        }
      }

      if (event.eventType === 'GROUP_MEMBER_ADDED') {
        const group = groups.get(event.groupId);
        const payload = event.payload as GroupMemberChangedPayload;

        if (group) {
          group.memberIds = uniqueIds([...group.memberIds, payload.friendId]);
          activity.push({
            eventId: event.eventId,
            groupId: event.groupId,
            eventType: event.eventType,
            tag: 'group',
            createdAt: event.createdAt,
            summary: `${friendName(friends, payload.friendId)} joined ${group.name}.`,
            refs: { friendId: payload.friendId, groupId: group.groupId },
          });
        }
      }

      if (event.eventType === 'GROUP_MEMBER_REMOVED') {
        const group = groups.get(event.groupId);
        const payload = event.payload as GroupMemberChangedPayload;

        if (group) {
          group.memberIds = group.memberIds.filter((memberId) => memberId !== payload.friendId);
          activity.push({
            eventId: event.eventId,
            groupId: event.groupId,
            eventType: event.eventType,
            tag: 'group',
            createdAt: event.createdAt,
            summary: `${friendName(friends, payload.friendId)} left ${group.name}.`,
            refs: { friendId: payload.friendId, groupId: group.groupId },
          });
        }
      }

      if (event.eventType === 'EXPENSE_CREATED') {
        const expenseEvent = event as DomainEvent<ExpenseCreatedPayload>;
        const payload = expenseEvent.payload;
        applyExpenseEvent(balances, expenseEvent);
        groupExpenses[event.groupId] ??= [];
        groupExpenses[event.groupId].push({
          groupId: event.groupId,
          expenseId: payload.expenseId,
          description: payload.description,
          currency: payload.currency,
          originalAmountMinor: payload.originalAmountMinor,
          amountUsdMicros: payload.amountUsdMicros,
          fxRateToUsd: payload.fxRateToUsd,
          transactionAt: payload.transactionAt,
          createdAt: event.createdAt,
          paidBy: payload.paidBy,
          owedBy: payload.owedBy,
        });
        activity.push({
          eventId: event.eventId,
          groupId: event.groupId,
          eventType: event.eventType,
          tag: 'expense',
          createdAt: event.createdAt,
          summary: `${payload.description || 'Expense'} added in ${groups.get(event.groupId)?.name ?? 'group'}.`,
          amountUsdMicros: payload.amountUsdMicros,
          currency: payload.currency,
          originalAmountMinor: payload.originalAmountMinor,
          refs: { expenseId: payload.expenseId, groupId: event.groupId },
        });
      }

      if (event.eventType === 'PAYMENT_INITIATED') {
        const payload = event.payload as PaymentInitiatedPayload;
        const settlement: Settlement = {
          groupId: event.groupId,
          settlementId: payload.settlementId,
          payerId: payload.payerId,
          payeeId: payload.payeeId,
          amountUsdMicros: payload.amountUsdMicros,
          createdAt: event.createdAt,
          status: 'PENDING',
        };
        settlements.set(payload.settlementId, settlement);
        allSettlements.set(payload.settlementId, settlement);
        activity.push({
          eventId: event.eventId,
          groupId: event.groupId,
          eventType: event.eventType,
          tag: 'payment',
          createdAt: event.createdAt,
          summary: `${friendName(friends, payload.payerId)} sent a payment to ${friendName(friends, payload.payeeId)}.`,
          amountUsdMicros: payload.amountUsdMicros,
          currency: payload.currency,
          originalAmountMinor: payload.originalAmountMinor,
          refs: { settlementId: payload.settlementId, groupId: event.groupId },
        });
      }

      if (event.eventType === 'PAYMENT_APPROVED') {
        const payload = event.payload as PaymentResolvedPayload;
        const settlement = allSettlements.get(payload.settlementId);

        if (settlement?.status === 'PENDING') {
          settlement.status = 'APPROVED';
          settlement.resolvedAt = event.createdAt;
          settlement.resolvedBy = payload.approvedBy;
          settlements.delete(payload.settlementId);
          addDebt(
            balances,
            settlement.groupId,
            settlement.payerId,
            settlement.payeeId,
            -settlement.amountUsdMicros,
          );
          activity.push({
            eventId: event.eventId,
            groupId: settlement.groupId,
            eventType: event.eventType,
            tag: 'payment',
            createdAt: event.createdAt,
            summary: `${friendName(friends, settlement.payeeId)} approved a payment from ${friendName(friends, settlement.payerId)}.`,
            amountUsdMicros: settlement.amountUsdMicros,
            refs: { settlementId: settlement.settlementId, groupId: settlement.groupId },
          });
        }
      }

      if (event.eventType === 'PAYMENT_REJECTED') {
        const payload = event.payload as PaymentResolvedPayload;
        const settlement = allSettlements.get(payload.settlementId);

        if (settlement?.status === 'PENDING') {
          settlement.status = 'REJECTED';
          settlement.resolvedAt = event.createdAt;
          settlement.resolvedBy = payload.approvedBy;
          settlements.delete(payload.settlementId);
          activity.push({
            eventId: event.eventId,
            groupId: settlement.groupId,
            eventType: event.eventType,
            tag: 'payment',
            createdAt: event.createdAt,
            summary: `${friendName(friends, settlement.payeeId)} rejected a payment from ${friendName(friends, settlement.payerId)}.`,
            amountUsdMicros: settlement.amountUsdMicros,
            refs: { settlementId: settlement.settlementId, groupId: settlement.groupId },
          });
        }
      }
    }

    for (const expenses of Object.values(groupExpenses)) {
      expenses.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const normalizedBalances = normalizeBalances(balances);
    const sortedActivity = activity.sort((a, b) => {
      const createdAtOrder = b.createdAt.localeCompare(a.createdAt);
      return createdAtOrder === 0 ? b.eventId.localeCompare(a.eventId) : createdAtOrder;
    });
    const friendsList = [...friends.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    const groupsList = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    const groupMembers = Object.fromEntries(
      groupsList.map((group) => [
        group.groupId,
        group.memberIds
          .map((memberId) => friends.get(memberId))
          .filter((friend): friend is Friend => Boolean(friend)),
      ]),
    );

    this.friendsSubject.next(friendsList);
    this.groupsSubject.next(groupsList);
    this.groupMembersSubject.next(groupMembers);
    this.groupExpensesSubject.next(groupExpenses);
    this.activityFeedSubject.next(sortedActivity);
    this.settlementsSubject.next([...allSettlements.values()]);
    this.balancesSubject.next(normalizedBalances);
    this.pendingSettlementsSubject.next([...settlements.values()]);
    this.dashboardSubject.next(
      buildDashboard(groupsList, friendsList, normalizedBalances, sortedActivity, [
        ...settlements.values(),
      ]),
    );
    this.syncStateSubject.next({
      ...this.syncStateSubject.value,
      pendingEvents: this.countPendingEvents(events),
    });
  }

  private countPendingEvents(events = this.eventsSubject.value): number {
    return events.filter((event) => event.syncStatus === 'local' || event.syncStatus === 'failed')
      .length;
  }

  private setOnline(online: boolean): void {
    this.syncStateSubject.next({ ...this.syncStateSubject.value, online });

    if (online) {
      void this.syncPendingEvents();
    }
  }
}

class IndexedDbEventStore implements EventStore {
  private db?: IDBPDatabase<DutchDb>;

  async loadEvents(): Promise<DomainEvent[]> {
    const db = await this.getDb();
    return (await db.getAll('events')).sort(compareEvents);
  }

  async upsertEvent(event: DomainEvent): Promise<void> {
    const db = await this.getDb();
    await db.put('events', event);
  }

  async updateSyncStatus(
    eventId: string,
    syncStatus: SyncStatus,
    retryCount: number,
    lastSyncError?: string,
  ): Promise<void> {
    const db = await this.getDb();
    const event = await db.get('events', eventId);

    if (!event) {
      return;
    }

    await db.put('events', { ...event, syncStatus, retryCount, lastSyncError });
  }

  private async getDb(): Promise<IDBPDatabase<DutchDb>> {
    if (!this.db) {
      this.db = await openDB<DutchDb>('dutch', 1, {
        upgrade(db) {
          const events = db.createObjectStore('events', { keyPath: 'eventId' });
          events.createIndex('by-created-at', 'createdAt');
          events.createIndex('by-sync-status', 'syncStatus');
        },
      });
    }

    return this.db;
  }
}

class TauriSqlEventStore implements EventStore {
  private dbPromise?: Promise<TauriDatabase>;

  async loadEvents(): Promise<DomainEvent[]> {
    const db = await this.getDb();
    const rows = await db.select<Array<{ payload: string }>>(
      'SELECT payload FROM event_log ORDER BY created_at ASC, event_id ASC',
    );
    return rows.map((row) => JSON.parse(row.payload) as DomainEvent);
  }

  async upsertEvent(event: DomainEvent): Promise<void> {
    const db = await this.getDb();
    await db.execute(
      `INSERT INTO event_log
        (event_id, group_id, event_type, payload, created_at, client_id, sync_status, retry_count, last_sync_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(event_id) DO UPDATE SET
        payload = excluded.payload,
        sync_status = excluded.sync_status,
        retry_count = excluded.retry_count,
        last_sync_error = excluded.last_sync_error`,
      [
        event.eventId,
        event.groupId,
        event.eventType,
        JSON.stringify(event),
        event.createdAt,
        event.clientId,
        event.syncStatus,
        event.retryCount,
        event.lastSyncError ?? null,
      ],
    );
  }

  async updateSyncStatus(
    eventId: string,
    syncStatus: SyncStatus,
    retryCount: number,
    lastSyncError?: string,
  ): Promise<void> {
    const db = await this.getDb();
    const rows = await db.select<Array<{ payload: string }>>(
      'SELECT payload FROM event_log WHERE event_id = $1 LIMIT 1',
      [eventId],
    );
    const event = rows[0] ? (JSON.parse(rows[0].payload) as DomainEvent) : undefined;

    if (!event) {
      return;
    }

    const updated = { ...event, syncStatus, retryCount, lastSyncError };
    await db.execute(
      `UPDATE event_log
       SET payload = $1, sync_status = $2, retry_count = $3, last_sync_error = $4
       WHERE event_id = $5`,
      [JSON.stringify(updated), syncStatus, retryCount, lastSyncError ?? null, eventId],
    );
  }

  private getDb(): Promise<TauriDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDb();
    }

    return this.dbPromise;
  }

  private async openDb(): Promise<TauriDatabase> {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    const db = (await Database.load('sqlite:dutch.db')) as TauriDatabase;

    await db.execute(
      `CREATE TABLE IF NOT EXISTS event_log (
        event_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        client_id TEXT NOT NULL,
        sync_status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_sync_error TEXT
      )`,
    );

    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_event_log_order ON event_log(created_at, event_id)',
    );
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_event_log_sync ON event_log(sync_status)',
    );

    return db;
  }
}

class NoopSyncTransport implements SyncTransport {
  async pushEvents(): Promise<{ acceptedEventIds: string[] }> {
    return { acceptedEventIds: [] };
  }
}

interface TauriDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

function createDefaultEventStore(): EventStore {
  return isTauriRuntime() ? new TauriSqlEventStore() : new IndexedDbEventStore();
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export function currencyMinorUnits(currency: string): number {
  const units = MINOR_UNITS[currency.toUpperCase()];

  if (units === undefined) {
    throw new Error(`Unsupported currency: ${currency}`);
  }

  return units;
}

export function parseAmountToMinorUnits(input: string, currency: string): number {
  const trimmed = input.trim();

  if (!trimmed) {
    return 0;
  }

  const scale = currencyMinorUnits(currency);
  const decimal = new Decimal(trimmed);

  if (decimal.isNegative()) {
    throw new Error('Amount cannot be negative.');
  }

  if (decimal.decimalPlaces() > scale) {
    throw new Error(`${currency.toUpperCase()} supports ${scale} decimal places.`);
  }

  return decimal.mul(new Decimal(10).pow(scale)).toNumber();
}

export function formatMinorUnits(amountMinor: number, currency: string): string {
  const scale = currencyMinorUnits(currency);
  return new Decimal(amountMinor).div(new Decimal(10).pow(scale)).toFixed(scale);
}

export function formatUsdMicros(amountUsdMicros: number): string {
  return new Decimal(amountUsdMicros).div(USD_MICROS_PER_UNIT).toFixed(2);
}

export function splitEqualMinorUnits(totalMinor: number, userIds: string[]): Array<{
  userId: string;
  amountMinor: number;
}> {
  if (userIds.length === 0) {
    return [];
  }

  const base = Math.floor(totalMinor / userIds.length);
  const remainder = totalMinor % userIds.length;

  return userIds.map((userId, index) => ({
    userId,
    amountMinor: base + (index < remainder ? 1 : 0),
  }));
}

export function splitPercentMinorUnits(
  totalMinor: number,
  rows: Array<{ userId: string; percent: string }>,
): Array<{ userId: string; amountMinor: number }> {
  const totalPercent = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row.percent || '0')),
    new Decimal(0),
  );

  if (!totalPercent.eq(100)) {
    throw new Error('Percent split must total 100%.');
  }

  return allocateByDecimalWeights(
    totalMinor,
    rows.map((row) => ({ userId: row.userId, weight: new Decimal(row.percent || '0') })),
  );
}

function allocateUsdMicros(
  rows: Array<{ userId: string; amountMinor: number }>,
  totalMinor: number,
  totalUsdMicros: number,
): MoneyAllocation[] {
  if (totalMinor <= 0) {
    throw new Error('Total amount must be greater than zero.');
  }

  const allocated = allocateByDecimalWeights(
    totalUsdMicros,
    rows.map((row) => ({ userId: row.userId, weight: new Decimal(row.amountMinor) })),
  );

  return allocated.map((row, index) => ({
    userId: row.userId,
    amountMinor: rows[index].amountMinor,
    amountUsdMicros: row.amountMinor,
  }));
}

function allocateByDecimalWeights(
  total: number,
  rows: Array<{ userId: string; weight: Decimal }>,
): Array<{ userId: string; amountMinor: number }> {
  const weightTotal = rows.reduce((sum, row) => sum.plus(row.weight), new Decimal(0));

  if (rows.length === 0 || weightTotal.lte(0)) {
    return rows.map((row) => ({ userId: row.userId, amountMinor: 0 }));
  }

  const provisional = rows.map((row, index) => {
    const exact = row.weight.div(weightTotal).mul(total);
    const floored = exact.floor();

    return {
      userId: row.userId,
      index,
      amountMinor: floored.toNumber(),
      remainder: exact.minus(floored),
    };
  });

  let remainder = total - provisional.reduce((sum, row) => sum + row.amountMinor, 0);
  const byRemainder = [...provisional].sort((a, b) => {
    const remainderOrder = b.remainder.comparedTo(a.remainder);
    return remainderOrder === 0 ? a.index - b.index : remainderOrder;
  });

  for (const row of byRemainder) {
    if (remainder <= 0) {
      break;
    }

    row.amountMinor += 1;
    remainder -= 1;
  }

  return provisional
    .sort((a, b) => a.index - b.index)
    .map((row) => ({ userId: row.userId, amountMinor: row.amountMinor }));
}

function buildDashboard(
  groups: Group[],
  friends: Friend[],
  balances: Balance[],
  activity: ActivityFeedItem[],
  pendingSettlements: Settlement[],
): DashboardAggregate {
  const friendNet = new Map<string, number>();
  const groupTotals = new Map<string, { youOwe: number; youAreOwed: number }>();
  let totalYouOweUsdMicros = 0;
  let totalYouAreOwedUsdMicros = 0;

  for (const balance of balances) {
    const groupTotal = groupTotals.get(balance.groupId) ?? { youOwe: 0, youAreOwed: 0 };

    if (balance.fromUserId === CURRENT_USER_ID) {
      totalYouOweUsdMicros += balance.amountUsdMicros;
      groupTotal.youOwe += balance.amountUsdMicros;
      friendNet.set(
        balance.toUserId,
        (friendNet.get(balance.toUserId) ?? 0) - balance.amountUsdMicros,
      );
    }

    if (balance.toUserId === CURRENT_USER_ID) {
      totalYouAreOwedUsdMicros += balance.amountUsdMicros;
      groupTotal.youAreOwed += balance.amountUsdMicros;
      friendNet.set(
        balance.fromUserId,
        (friendNet.get(balance.fromUserId) ?? 0) + balance.amountUsdMicros,
      );
    }

    groupTotals.set(balance.groupId, groupTotal);
  }

  const friendBalances = friends
    .filter((friend) => friend.friendId !== CURRENT_USER_ID)
    .map((friend) => ({
      friendId: friend.friendId,
      displayName: friend.displayName,
      phoneNumber: friend.phoneNumber,
      netUsdMicros: friendNet.get(friend.friendId) ?? 0,
    }))
    .sort((a, b) => Math.abs(b.netUsdMicros) - Math.abs(a.netUsdMicros));

  const groupSummaries = groups.map((group) => {
    const totals = groupTotals.get(group.groupId) ?? { youOwe: 0, youAreOwed: 0 };

    return {
      groupId: group.groupId,
      name: group.name,
      memberIds: group.memberIds,
      youOweUsdMicros: totals.youOwe,
      youAreOwedUsdMicros: totals.youAreOwed,
      netUsdMicros: totals.youAreOwed - totals.youOwe,
      latestActivity: activity.find((item) => item.groupId === group.groupId),
    };
  });

  return {
    totalYouOweUsdMicros,
    totalYouAreOwedUsdMicros,
    pendingApprovalCount: pendingSettlements.filter(
      (settlement) => settlement.payeeId === CURRENT_USER_ID,
    ).length,
    groupCount: groups.length,
    friendCount: friends.filter((friend) => friend.friendId !== CURRENT_USER_ID).length,
    recentActivity: activity.slice(0, 8),
    friendBalances,
    groupSummaries,
  };
}

function friendName(friends: Map<string, Friend>, friendId: string): string {
  return friends.get(friendId)?.displayName ?? friendId;
}

function assertGroupMembers(group: Group, userIds: string[]): void {
  const memberIds = new Set(group.memberIds);
  const unknownUserId = userIds.find((userId) => !memberIds.has(userId));

  if (unknownUserId) {
    throw new Error(`User ${unknownUserId} is not in ${group.name}.`);
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/[^\d+]/g, '').trim();
}

function isValidPhoneNumber(phoneNumber: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phoneNumber);
}

function initialsFor(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function applyExpenseEvent(
  balances: Map<string, number>,
  event: DomainEvent<ExpenseCreatedPayload>,
): void {
  const totalUsdMicros = event.payload.amountUsdMicros;

  for (const debtor of event.payload.owedBy) {
    const payerShares = allocateByDecimalWeights(
      debtor.amountUsdMicros,
      event.payload.paidBy.map((payer) => ({
        userId: payer.userId,
        weight: new Decimal(payer.amountUsdMicros),
      })),
    );

    for (const payerShare of payerShares) {
      if (debtor.userId === payerShare.userId || payerShare.amountMinor === 0) {
        continue;
      }

      addDebt(
        balances,
        event.groupId,
        debtor.userId,
        payerShare.userId,
        payerShare.amountMinor,
      );
    }
  }

  const paidTotal = event.payload.paidBy.reduce((sum, row) => sum + row.amountUsdMicros, 0);
  const owedTotal = event.payload.owedBy.reduce((sum, row) => sum + row.amountUsdMicros, 0);

  if (paidTotal !== totalUsdMicros || owedTotal !== totalUsdMicros) {
    throw new Error('Corrupt expense event: participant USD totals do not match event total.');
  }
}

function addDebt(
  balances: Map<string, number>,
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountUsdMicros: number,
): void {
  const key = balanceKey(groupId, fromUserId, toUserId);
  balances.set(key, (balances.get(key) ?? 0) + amountUsdMicros);
}

function normalizeBalances(balances: Map<string, number>): Balance[] {
  const pairTotals = new Map<string, { groupId: string; a: string; b: string; amount: number }>();

  for (const [key, amount] of balances.entries()) {
    const [groupId, fromUserId, toUserId] = key.split('|');
    const [a, b] = [fromUserId, toUserId].sort();
    const pairKey = `${groupId}|${a}|${b}`;
    const existing = pairTotals.get(pairKey) ?? { groupId, a, b, amount: 0 };
    existing.amount += fromUserId === a ? amount : -amount;
    pairTotals.set(pairKey, existing);
  }

  return [...pairTotals.values()]
    .filter((pair) => pair.amount !== 0)
    .map((pair) =>
      pair.amount > 0
        ? {
            groupId: pair.groupId,
            fromUserId: pair.a,
            toUserId: pair.b,
            amountUsdMicros: pair.amount,
          }
        : {
            groupId: pair.groupId,
            fromUserId: pair.b,
            toUserId: pair.a,
            amountUsdMicros: Math.abs(pair.amount),
          },
    )
    .sort((a, b) =>
      `${a.groupId}|${a.fromUserId}|${a.toUserId}`.localeCompare(
        `${b.groupId}|${b.fromUserId}|${b.toUserId}`,
      ),
    );
}

function balanceKey(groupId: string, fromUserId: string, toUserId: string): string {
  return `${groupId}|${fromUserId}|${toUserId}`;
}

function sumMinor(rows: Array<{ amountMinor: number }>): number {
  return rows.reduce((sum, row) => {
    assertPositiveInteger(row.amountMinor, 'Amount');
    return sum + row.amountMinor;
  }, 0);
}

function minorToUsdMicros(amountMinor: number, currency: string, fxRateToUsd: string): number {
  const scale = currencyMinorUnits(currency);
  return new Decimal(amountMinor)
    .div(new Decimal(10).pow(scale))
    .mul(fxRateToUsd)
    .mul(USD_MICROS_PER_UNIT)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

function assertValidFxRate(fxRateToUsd: string): void {
  const rate = new Decimal(fxRateToUsd);

  if (!rate.isFinite() || rate.lte(0)) {
    throw new Error('A valid FX rate is required before creating an expense.');
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function upsertEvent(events: DomainEvent[], nextEvent: DomainEvent): DomainEvent[] {
  const map = new Map(events.map((event) => [event.eventId, event]));
  map.set(nextEvent.eventId, nextEvent);
  return [...map.values()].sort(compareEvents);
}

function compareEvents(a: DomainEvent, b: DomainEvent): number {
  const createdAtOrder = a.createdAt.localeCompare(b.createdAt);
  return createdAtOrder === 0 ? a.eventId.localeCompare(b.eventId) : createdAtOrder;
}

function getOrCreateClientId(): string {
  if (typeof localStorage === 'undefined') {
    return ulid();
  }

  const existing = localStorage.getItem(DEFAULT_CLIENT_ID_KEY);

  if (existing) {
    return existing;
  }

  const next = ulid();
  localStorage.setItem(DEFAULT_CLIENT_ID_KEY, next);
  return next;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
