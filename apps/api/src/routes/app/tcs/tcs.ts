import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { listPublishedTcsHandler } from './tcs.handler';

export const tcsRoute = new Hono<HonoEnv>().get('/:role', (c) => listPublishedTcsHandler(c));
