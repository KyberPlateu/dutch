import { Component, Inject, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { AppPreferencesService, SUPPORTED_CURRENCIES } from '../../core/app-preferences.service';
import {
  CURRENT_USER_ID,
  EventSourcingService,
  Friend,
  Group,
} from '../../core/event-sourcing.service';

export interface GroupEditorDialogData {
  groupId?: string;
}

@Component({
  selector: 'app-group-editor-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEditing() ? 'Manage group' : 'Create group' }}</h2>
    <mat-dialog-content class="dialog-body">
      <mat-form-field appearance="outline">
        <mat-label>Group name</mat-label>
        <input matInput [(ngModel)]="name" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Default currency</mat-label>
        <mat-select [(ngModel)]="defaultCurrency">
          @for (currency of currencies; track currency) {
            <mat-option [value]="currency">{{ currency }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <section>
        <div class="section-title">
          <h3>Members</h3>
          <span>{{ selectedMemberIds().size }} selected</span>
        </div>
        <mat-selection-list>
          @for (friend of friends(); track friend.friendId) {
            <mat-list-option
              [disabled]="friend.friendId === currentUserId"
              [selected]="selectedMemberIds().has(friend.friendId)"
              (selectedChange)="setMemberSelected(friend.friendId, $event)"
            >
              <mat-icon matListItemIcon>{{ friend.friendId === currentUserId ? 'person' : 'person_outline' }}</mat-icon>
              <span matListItemTitle>{{ friend.displayName }}</span>
              <span matListItemLine>{{ friend.phoneNumber }}</span>
            </mat-list-option>
          }
        </mat-selection-list>
      </section>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="save()">
        {{ isEditing() ? 'Save changes' : 'Create group' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .dialog-body {
        display: grid;
        gap: 0.75rem;
        min-width: min(30rem, 82vw);
        padding-top: 0.5rem;
      }

      .section-title {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
      }

      .section-title h3 {
        margin: 0;
      }

      .section-title span {
        color: var(--dutch-muted);
        font-size: 0.8125rem;
        font-weight: 700;
      }

      .error {
        margin: 0;
        color: var(--dutch-negative);
        font-size: 0.875rem;
      }
    `,
  ],
})
export class GroupEditorDialogComponent {
  private readonly eventService = inject(EventSourcingService);
  private readonly preferences = inject(AppPreferencesService);
  private readonly dialogRef = inject(MatDialogRef<GroupEditorDialogComponent>);

  protected readonly currentUserId = CURRENT_USER_ID;
  protected readonly currencies = SUPPORTED_CURRENCIES;
  protected readonly friends = toSignal(this.eventService.friends$, { initialValue: [] as Friend[] });
  protected readonly groups = toSignal(this.eventService.groups$, { initialValue: [] as Group[] });
  protected readonly selectedMemberIds = signal(new Set<string>([CURRENT_USER_ID]));
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected name = '';
  protected defaultCurrency: string = this.preferences.globalCurrency();

  constructor(@Inject(MAT_DIALOG_DATA) protected readonly data: GroupEditorDialogData | null) {
    const group = this.currentGroup();

    if (group) {
      this.name = group.name;
      this.defaultCurrency = group.defaultCurrency;
      this.selectedMemberIds.set(new Set(group.memberIds));
    }
  }

  protected isEditing(): boolean {
    return Boolean(this.data?.groupId);
  }

  protected setMemberSelected(friendId: string, selected: boolean): void {
    if (friendId === CURRENT_USER_ID) {
      return;
    }

    this.selectedMemberIds.update((ids) => {
      const next = new Set(ids);

      if (selected) {
        next.add(friendId);
      } else {
        next.delete(friendId);
      }

      next.add(CURRENT_USER_ID);
      return next;
    });
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);

    try {
      if (this.isEditing()) {
        await this.updateExistingGroup();
      } else {
        await this.eventService.createGroup({
          name: this.name,
          defaultCurrency: this.defaultCurrency,
          memberIds: [...this.selectedMemberIds()],
        });
      }

      this.dialogRef.close(true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not save group.');
    } finally {
      this.saving.set(false);
    }
  }

  private async updateExistingGroup(): Promise<void> {
    const group = this.currentGroup();

    if (!group) {
      throw new Error('Group not found.');
    }

    if (this.name.trim() !== group.name || this.defaultCurrency !== group.defaultCurrency) {
      await this.eventService.updateGroup({
        groupId: group.groupId,
        name: this.name,
        defaultCurrency: this.defaultCurrency,
      });
    }

    const nextMembers = this.selectedMemberIds();
    const currentMembers = new Set(group.memberIds);

    for (const friendId of nextMembers) {
      if (!currentMembers.has(friendId)) {
        await this.eventService.addGroupMember({ groupId: group.groupId, friendId });
      }
    }

    for (const friendId of currentMembers) {
      if (!nextMembers.has(friendId)) {
        await this.eventService.removeGroupMember({ groupId: group.groupId, friendId });
      }
    }
  }

  private currentGroup(): Group | undefined {
    return this.groups().find((group) => group.groupId === this.data?.groupId);
  }
}
