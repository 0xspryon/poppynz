import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { listUserSearchesHandler } from './user-searches.handler';

export const adminUserSearchesRoute = new Hono<HonoEnv>().get('/', (c) =>
  listUserSearchesHandler(c)
);
