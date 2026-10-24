import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  getTaxAccessHandler,
  getTaxConfigHandler,
  listTaxAuditHandler,
  supersedeTaxRateHandler,
  supersedeTaxRegistrationHandler,
  supersedeTaxTreatmentHandler,
  taxCollectedCsvHandler,
  taxCollectedReportHandler
} from './tax.handler';

/** The accountant tax portal (permission `tax` / `taxReport`). */
export const taxRoute = new Hono<HonoEnv>()
  .get('/access', (c) => getTaxAccessHandler(c))
  .get('/config', (c) => getTaxConfigHandler(c))
  .post('/rates', (c) => supersedeTaxRateHandler(c))
  .post('/treatments', (c) => supersedeTaxTreatmentHandler(c))
  .post('/registrations', (c) => supersedeTaxRegistrationHandler(c))
  .get('/audit', (c) => listTaxAuditHandler(c))
  .get('/reports/collected', (c) => taxCollectedReportHandler(c))
  .get('/reports/collected.csv', (c) => taxCollectedCsvHandler(c));
