import { Hono } from 'hono';
import type { HonoEnv } from '../../../../app-env';
import { latestDevMagicLinkHandler } from './dev-inbox.handler';
import { isDevInboxEnabled } from '../../../../lib/dev-magic-links';

export const devInboxRoute = new Hono<HonoEnv>().get('/dev/magic-link', (c) =>
  latestDevMagicLinkHandler(c)
);

/**
 * What the app actually mounts: the inbox route only when the dev guard
 * passes at startup, otherwise an empty router (the path 404s like any
 * unknown one). The cast keeps the RPC client's type, which the web's dev
 * build uses; the handler re-checks the guard on every request too.
 */
export const mountedDevInboxRoute = (
  env: Record<string, string | undefined> = process.env
): typeof devInboxRoute =>
  isDevInboxEnabled(env) ? devInboxRoute : (new Hono<HonoEnv>() as unknown as typeof devInboxRoute);
