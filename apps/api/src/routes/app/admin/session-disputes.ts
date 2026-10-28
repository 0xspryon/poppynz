import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  decideSessionDisputeHandler,
  getSessionDisputeHandler,
  listSessionDisputesHandler
} from './session-disputes.handler';

/** The admin dispute queue (Tier 3; permission `sessionDispute`). */
export const adminSessionDisputesRoute = new Hono<HonoEnv>()
  .get('/', (c) => listSessionDisputesHandler(c))
  .get('/:id', (c) => getSessionDisputeHandler(c))
  .post('/:id/decide', (c) => decideSessionDisputeHandler(c));
