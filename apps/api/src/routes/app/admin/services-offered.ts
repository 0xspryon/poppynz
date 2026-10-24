import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  listServicesForReviewHandler,
  reviewServiceOfferedHandler
} from '../me/services-offered.handler';

/** Admin review queue for helpers' custom services (UAT #34). */
export const adminServicesOfferedRoute = new Hono<HonoEnv>()
  .get('/review', (c) => listServicesForReviewHandler(c))
  .post('/:id/review', (c) => reviewServiceOfferedHandler(c));
