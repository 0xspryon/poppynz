import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  decideSafetyVerificationHandler,
  getSafetyVerificationReportHandler,
  listSafetyVerificationsForReviewHandler
} from '../safety-verification/safety-verification.handler';

/** Admin review queue. Every route here needs the `review` capability, which
 * only the admin role carries. */
export const adminSafetyVerificationsRoute = new Hono<HonoEnv>()
  .get('/', (c) => listSafetyVerificationsForReviewHandler(c))
  .post('/:id/decision', (c) => decideSafetyVerificationHandler(c))
  .get('/:id/report', (c) => getSafetyVerificationReportHandler(c));
