import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_USER_ID,
  DUTCH_EVENT_STORE,
  DUTCH_SYNC_TRANSPORT,
  DomainEvent,
  EventStore,
  SyncStatus,
} from '../../core/event-sourcing.service';
import { AddExpenseFlowComponent } from './add-expense-flow.component';

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

describe('AddExpenseFlowComponent', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [AddExpenseFlowComponent, NoopAnimationsModule],
      providers: [
        { provide: DUTCH_EVENT_STORE, useClass: MemoryEventStore },
        {
          provide: DUTCH_SYNC_TRANSPORT,
          useValue: { pushEvents: async () => ({ acceptedEventIds: [] }) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ groupId: 'group-trip' }),
            },
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn().mockResolvedValue(true) },
        },
      ],
    }).compileComponents();
  });

  it('defaults group expenses to current user as full payer and current datetime', async () => {
    const before = new Date();
    const fixture = TestBed.createComponent(AddExpenseFlowComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      payers: () => Array<{ userId: string; amount: string }>;
      date: () => Date;
      time: () => string;
    };
    const payer = component.payers()[0];

    expect(payer.userId).toBe(CURRENT_USER_ID);
    expect(component.date().getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(component.time()).toMatch(/^\d{2}:\d{2}$/);
  });

  it('uses the global currency as the default for a new expense', async () => {
    localStorage.setItem('dutch.globalCurrency', 'GBP');

    const fixture = TestBed.createComponent(AddExpenseFlowComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      currency: () => string;
    };

    expect(component.currency()).toBe('GBP');
  });
});
