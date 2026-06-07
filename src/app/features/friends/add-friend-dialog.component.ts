import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { EventSourcingService } from '../../core/event-sourcing.service';

@Component({
  selector: 'app-add-friend-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Add friend</h2>
    <mat-dialog-content class="dialog-body">
      <mat-form-field appearance="outline">
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="displayName" autocomplete="name" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>Phone number</mat-label>
        <input matInput [(ngModel)]="phoneNumber" inputmode="tel" autocomplete="tel" />
        <mat-hint>Phone lookup is local-only until backend search exists.</mat-hint>
      </mat-form-field>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" type="button" [disabled]="saving()" (click)="save()">
        Add friend
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .dialog-body {
        display: grid;
        gap: 0.75rem;
        min-width: min(24rem, 78vw);
        padding-top: 0.5rem;
      }

      .error {
        margin: 0;
        color: var(--dutch-negative);
        font-size: 0.875rem;
      }
    `,
  ],
})
export class AddFriendDialogComponent {
  private readonly eventService = inject(EventSourcingService);
  private readonly dialogRef = inject(MatDialogRef<AddFriendDialogComponent>);

  protected displayName = '';
  protected phoneNumber = '';
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);

    try {
      await this.eventService.addFriend({
        displayName: this.displayName,
        phoneNumber: this.phoneNumber,
      });
      this.dialogRef.close(true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not add friend.');
    } finally {
      this.saving.set(false);
    }
  }
}
