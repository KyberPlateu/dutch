import { Routes } from '@angular/router';
import { DashboardShellComponent } from './features/dashboard/dashboard-shell.component';
import { AddExpenseFlowComponent } from './features/expenses/add-expense-flow.component';
import { GroupDetailComponent } from './features/groups/group-detail.component';

export const routes: Routes = [
  { path: '', component: DashboardShellComponent },
  { path: 'groups/:groupId', component: GroupDetailComponent },
  { path: 'groups/:groupId/expenses/new', component: AddExpenseFlowComponent },
  { path: 'expenses/new', component: AddExpenseFlowComponent },
];
