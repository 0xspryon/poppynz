import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  createKycDocumentTypeHandler,
  deleteKycDocumentTypeHandler,
  listKycDocumentTypesHandler,
  submitKycDocumentHandler,
  updateKycDocumentTypeHandler
} from './kyc-docs.handler';

export const kycDocsRoute = new Hono<HonoEnv>()
  .post('/', (c) => submitKycDocumentHandler(c))
  .get('/types', (c) => listKycDocumentTypesHandler(c))
  .post('/types', (c) => createKycDocumentTypeHandler(c))
  .patch('/types/:id', (c) => updateKycDocumentTypeHandler(c))
  .delete('/types/:id', (c) => deleteKycDocumentTypeHandler(c));
