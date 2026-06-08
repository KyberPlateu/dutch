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
  templateUrl: './add-friend-dialog.component.html',
  styleUrl: './add-friend-dialog.component.scss',
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
