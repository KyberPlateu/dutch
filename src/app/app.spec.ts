import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DUTCH_EVENT_STORE,
  DUTCH_SYNC_TRANSPORT,
  DomainEvent,
  EventStore,
  SyncStatus,
} from './core/event-sourcing.service';
import { App } from './app';

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

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: DUTCH_EVENT_STORE, useClass: MemoryEventStore },
        {
          provide: DUTCH_SYNC_TRANSPORT,
          useValue: { pushEvents: async () => ({ acceptedEventIds: [] }) },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the routed shell', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
});
