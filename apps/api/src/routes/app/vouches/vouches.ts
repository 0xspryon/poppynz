import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  declineVouchHandler,
  listMyVouchesHandler,
  listVouchRequestsHandler,
  requestVouchHandler,
  submitVouchHandler,
  withdrawVouchHandler
} from './vouches.handler';

export const vouchesRoute = new Hono<HonoEnv>()
  .get('/mine', (c) => listMyVouchesHandler(c))
  .get('/requests', (c) => listVouchRequestsHandler(c))
  .post('/', (c) => requestVouchHandler(c))
  .post('/:id/submit', (c) => submitVouchHandler(c))
  .post('/:id/decline', (c) => declineVouchHandler(c))
  .post('/:id/withdraw', (c) => withdrawVouchHandler(c));
