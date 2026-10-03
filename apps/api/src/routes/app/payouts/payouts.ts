import { Hono } from 'hono';
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
  .post('/dashboard', (c) => payoutsDashboardHandler(c));
