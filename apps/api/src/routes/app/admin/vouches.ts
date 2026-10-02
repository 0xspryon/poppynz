import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { flagVouchHandler, revokeVouchHandler } from '../vouches/vouches.handler';

export const adminVouchesRoute = new Hono<HonoEnv>()
  .post('/:id/flag', (c) => flagVouchHandler(c))
  .post('/:id/revoke', (c) => revokeVouchHandler(c));
