import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DUTCH_EVENT_STORE,
  DUTCH_SYNC_TRANSPORT,
  DomainEvent,
  EventStore,
  SyncStatus,
} from '../../core/event-sourcing.service';
import { DashboardShellComponent } from './dashboard-shell.component';

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

describe('DashboardShellComponent', () => {
  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: DUTCH_EVENT_STORE, useClass: MemoryEventStore },
        {
          provide: DUTCH_SYNC_TRANSPORT,
          useValue: { pushEvents: async () => ({ acceptedEventIds: [] }) },
        },
      ],
    }).compileComponents();
  });

  it('renders Friends and Groups sections on first load', async () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Friends');
    expect(text).toContain('Groups');
    expect(text).toContain("Europe Trip '24");
  });
});
