import { Hono } from 'hono';
import type { HonoEnv } from '../../../app-env';
import {
  dismissFamilyWelcomeHandler,
  getFamilyOnboardingHandler,
  getOnboardingHandler,
  getOnboardingHistoryHandler
} from './onboarding.handler';

export const onboardingRoute = new Hono<HonoEnv>()
  .get('/history', (c) => getOnboardingHistoryHandler(c))
  .get('/family', (c) => getFamilyOnboardingHandler(c))
  .post('/family/welcome-dismissal', (c) => dismissFamilyWelcomeHandler(c))
  .get('/', (c) => getOnboardingHandler(c));
