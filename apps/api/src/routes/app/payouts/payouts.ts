import { Hono } from 'hono';
import { listHelperTransfersHandler } from './transfers';
import type { HonoEnv } from '@/api/app-env';
import {
  getPayoutsHandler,
  payoutsDashboardHandler,
  refreshPayoutsHandler,
  startPayoutsOnboardingHandler
} from './payouts.handler';

export const payoutsRoute = new Hono<HonoEnv>()
  .get('/', (c) => getPayoutsHandler(c))
  .post('/onboarding', (c) => startPayoutsOnboardingHandler(c))
  .post('/refresh', (c) => refreshPayoutsHandler(c))
  .post('/dashboard', (c) => payoutsDashboardHandler(c))
  // Tier 3 step 2: the helper's per-cycle transfers.
  .get('/transfers', (c) => listHelperTransfersHandler(c));
