import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  billingClockCapabilitiesHandler,
  getBillingClockContractHandler,
  isBillingClockEnabled,
  listBillingClockContractsHandler,
  runBillingClockHandler
} from './billing-clock.handler';

/** Always mounted at /admin/capabilities: which optional admin tools are on. */
export const adminCapabilitiesRoute = new Hono<HonoEnv>().get('/', (c) =>
  billingClockCapabilitiesHandler(c)
);

/** Staging UAT: the billing fast-forward (permission `billingClock`). */
export const adminBillingClockRoute = new Hono<HonoEnv>()
  .get('/contracts', (c) => listBillingClockContractsHandler(c))
  .get('/contracts/:id', (c) => getBillingClockContractHandler(c))
  .post('/contracts/:id/runs', (c) => runBillingClockHandler(c));

/**
 * What the app actually mounts: the fast-forward routes only when the switch
 * is on at startup (ENVIRONMENT staging|dev, BILLING_TIME_TRAVEL=enabled, a
 * Stripe test key), otherwise an empty router (the paths 404 like any unknown
 * one). The cast keeps the RPC client's type; every program re-checks the
 * switch on each request too.
 */
export const mountedBillingClockRoute = (
  env: Record<string, string | undefined> = process.env
): typeof adminBillingClockRoute =>
  isBillingClockEnabled(env)
    ? adminBillingClockRoute
    : (new Hono<HonoEnv>() as unknown as typeof adminBillingClockRoute);
