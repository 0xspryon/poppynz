import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { createUserSearchHandler } from './user-searches.handler';

export const userSearchesRoute = new Hono<HonoEnv>().post('/', (c) => createUserSearchHandler(c));
