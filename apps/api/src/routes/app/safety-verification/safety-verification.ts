import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  addSafetyVerificationItemHandler,
  getMySafetyVerificationHandler,
  orderSafetyCheckHandler,
  removeSafetyVerificationItemHandler,
  submitSafetyDocumentHandler
} from './safety-verification.handler';

/** Applicant-facing safety verification. Both routes to being verified live
 * here; the admin decision surface is mounted separately under /admin.
 *
 * `/items` is the basket — an applicant builds it from the documents page and
 * settles it with `/order`. */
export const safetyVerificationRoute = new Hono<HonoEnv>()
  .get('/', (c) => getMySafetyVerificationHandler(c))
  .post('/items', (c) => addSafetyVerificationItemHandler(c))
  .delete('/items/:itemId', (c) => removeSafetyVerificationItemHandler(c))
  .post('/order', (c) => orderSafetyCheckHandler(c))
  .post('/document', (c) => submitSafetyDocumentHandler(c));
