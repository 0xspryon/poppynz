import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { lookupGooglePlaceHandler, placeSuggestionsHandler } from './geocoding.handler';

export const geocodingRoute = new Hono<HonoEnv>()
  .get('/google-place', (c) => lookupGooglePlaceHandler(c))
  .get('/place-suggestions', (c) => placeSuggestionsHandler(c));
