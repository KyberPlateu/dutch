import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { SplitMode } from '../../core/event-sourcing.service';

export interface SplitDialogData {
  splitMode: SplitMode;
  payers: Array<{ userId: string; amount: string }>;
  participants: Array<{ userId: string; amount: string; percent: string; selected: boolean }>;
  members: Array<{ friendId: string; displayName: string }>;
  nameFor: (id: string) => string;
}

@Component({
  selector: 'app-split-adjustment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './split-adjustment-dialog.component.html',
  styleUrl: './split-adjustment-dialog.component.scss',
})
export class SplitAdjustmentDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<SplitAdjustmentDialogComponent>);
  public readonly data = inject<SplitDialogData>(MAT_DIALOG_DATA);

  // We operate on copies of the data, so we don't mutate the parent until saved.
  public splitMode: SplitMode = this.data.splitMode;
  public payers = JSON.parse(JSON.stringify(this.data.payers)) as SplitDialogData['payers'];
  public participants = JSON.parse(JSON.stringify(this.data.participants)) as SplitDialogData['participants'];

  protected selectedParticipants() {
    return this.participants.filter(p => p.selected);
  }

  protected addPayer(): void {
    const used = new Set(this.payers.map(p => p.userId));
    const next = this.data.members.find(m => !used.has(m.friendId));
    if (next) {
      this.payers.push({ userId: next.friendId, amount: '0.00' });
    }
  }

  protected removePayer(index: number): void {
    if (this.payers.length > 1) {
      this.payers.splice(index, 1);
    }
  }

  protected save(): void {
    this.dialogRef.close({
      splitMode: this.splitMode,
      payers: this.payers,
      participants: this.participants,
    });
  }
}
