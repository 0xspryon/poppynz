import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  addReimbursementNoteHandler,
  getAccountantAccessHandler,
  getReimbursementHandler,
  listReimbursementsHandler,
  reconcileReimbursementHandler,
  reconciliationCsvHandler,
  reconciliationHandler,
  reimbursementsCsvHandler,
  reportCsvHandler,
  reportHandler,
  resolveReconciliationItemHandler,
  runReconciliationHandler
} from './accountant.handler';

/** The accountant's books (Tier 3 step 5; permissions `reimbursements`,
 * `reconciliation`). */
export const accountantRoute = new Hono<HonoEnv>()
  .get('/access', (c) => getAccountantAccessHandler(c))
  .get('/reimbursements', (c) => listReimbursementsHandler(c))
  .get('/reimbursements.csv', (c) => reimbursementsCsvHandler(c))
  .get('/reimbursements/:key', (c) => getReimbursementHandler(c))
  .post('/reimbursements/:key/notes', (c) => addReimbursementNoteHandler(c))
  .post('/reimbursements/:key/reconcile', (c) => reconcileReimbursementHandler(c))
  .get('/reports/:report{[a-z]+\\.csv}', (c) => reportCsvHandler(c))
  .get('/reports/:report', (c) => reportHandler(c))
  .get('/reconciliation', (c) => reconciliationHandler(c))
  .get('/reconciliation.csv', (c) => reconciliationCsvHandler(c))
  .post('/reconciliation/runs', (c) => runReconciliationHandler(c))
  .post('/reconciliation/items/:key/resolve', (c) => resolveReconciliationItemHandler(c));
