import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  confirmCardSetupHandler,
  getBillingHandler,
  startCardSetupHandler
} from './billing.handler';
import { refundReceiptHandler } from './refunds';

/** A family's card on file and payment history (billing permission). */
export const billingRoute = new Hono<HonoEnv>()
  .get('/', (c) => getBillingHandler(c))
  .post('/card/setup', (c) => startCardSetupHandler(c))
  .post('/card/confirm', (c) => confirmCardSetupHandler(c))
  // Tier 3 step 2: a session refund's receipt (credit note).
  .get('/refunds/:id/receipt', (c) => refundReceiptHandler(c));
