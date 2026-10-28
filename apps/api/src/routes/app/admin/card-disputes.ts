import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  allocateHandler,
  cardDisputeFlagsHandler,
  getCardDisputeHandler,
  listCardDisputesHandler,
  resumeFamilyHandler,
  saveSummaryHandler,
  submitEvidenceHandler,
  suspendFamilyHandler
} from './card-disputes.handler';

/** Card disputes (Tier 3 step 4; permission `cardDispute`). */
export const adminCardDisputesRoute = new Hono<HonoEnv>()
  .get('/', (c) => listCardDisputesHandler(c))
  .get('/flags', (c) => cardDisputeFlagsHandler(c))
  .post('/families/:userId/suspend', (c) => suspendFamilyHandler(c))
  .post('/families/:userId/resume', (c) => resumeFamilyHandler(c))
  .get('/:id', (c) => getCardDisputeHandler(c))
  .put('/:id/summary', (c) => saveSummaryHandler(c))
  .post('/:id/evidence', (c) => submitEvidenceHandler(c))
  .post('/:id/allocations', (c) => allocateHandler(c));
