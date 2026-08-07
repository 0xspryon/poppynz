import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { getFamilyHandler, searchFamiliesHandler } from './families.handler';

export const familiesRoute = new Hono<HonoEnv>()
  .get('/search', (c) => searchFamiliesHandler(c))
  .get('/:userId', (c) => getFamilyHandler(c));
