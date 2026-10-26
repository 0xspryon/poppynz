import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  createTcDocumentHandler,
  createTcDraftHandler,
  deleteTcDocumentHandler,
  getAdminTcHandler,
  listAdminTcsHandler,
  listAgreementSignaturesHandler,
  previewTcTemplateHandler,
  publishTcDraftHandler,
  updateTcDocumentHandler,
  updateTcDraftHandler
} from '../tcs/tcs.handler';

export const adminTcsRoute = new Hono<HonoEnv>()
  .get('/', (c) => listAdminTcsHandler(c))
  .post('/', (c) => createTcDocumentHandler(c))
  // Literal before "/:id" so it never matches as a document id.
  .get('/agreement-signatures', (c) => listAgreementSignaturesHandler(c))
  .get('/:id', (c) => getAdminTcHandler(c))
  .patch('/:id', (c) => updateTcDocumentHandler(c))
  .delete('/:id', (c) => deleteTcDocumentHandler(c))
  .post('/:id/draft', (c) => createTcDraftHandler(c))
  .patch('/:id/draft', (c) => updateTcDraftHandler(c))
  .post('/:id/publish', (c) => publishTcDraftHandler(c))
  .post('/:id/preview', (c) => previewTcTemplateHandler(c));
