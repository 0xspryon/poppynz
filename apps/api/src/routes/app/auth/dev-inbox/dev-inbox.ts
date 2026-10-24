import { Hono } from 'hono';
import type { HonoEnv } from '../../../../app-env';
import { latestDevMagicLinkHandler } from './dev-inbox.handler';

export const devInboxRoute = new Hono<HonoEnv>().get('/dev/magic-link', (c) =>
  latestDevMagicLinkHandler(c)
);
