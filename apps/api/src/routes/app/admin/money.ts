import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  decideManualPayoutHandler,
  listFailedRefundsHandler,
  listPayoutQueueHandler,
  markRefundHandledHandler,
  recordManualPayoutHandler,
  retryRefundHandler,
  retryTransferHandler
} from './money.handler';

/** The admins' money queues (Tier 3 step 2; permissions `payoutQueue`,
 * `refundQueue`). */
export const adminMoneyRoute = new Hono<HonoEnv>()
  .get('/payouts', (c) => listPayoutQueueHandler(c))
  .post('/transfers/:id/manual-payout', (c) => recordManualPayoutHandler(c))
  .post('/transfers/:id/retry', (c) => retryTransferHandler(c))
  .post('/manual-payouts/:id/decide', (c) => decideManualPayoutHandler(c))
  .get('/refunds', (c) => listFailedRefundsHandler(c))
  .post('/refunds/:id/retry', (c) => retryRefundHandler(c))
  .post('/refunds/:id/handled', (c) => markRefundHandledHandler(c));
