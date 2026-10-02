import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  confirmCardSetupHandler,
  getBillingHandler,
  startCardSetupHandler
} from './billing.handler';

/** A family's card on file and payment history (billing permission). */
export const billingRoute = new Hono<HonoEnv>()
  .get('/', (c) => getBillingHandler(c))
  .post('/card/setup', (c) => startCardSetupHandler(c))
  .post('/card/confirm', (c) => confirmCardSetupHandler(c));
