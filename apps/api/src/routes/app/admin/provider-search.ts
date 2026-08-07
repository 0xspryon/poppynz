import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { scheduleProviderSearchReindexHandler } from './provider-search.handler';

export const adminProviderSearchRoute = new Hono<HonoEnv>().post('/reindex', (c) =>
  scheduleProviderSearchReindexHandler(c)
);
