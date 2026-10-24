import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  getAdminKycDocumentFileUrlHandler,
  reviewAdminKycDocumentHandler,
  updateAdminKycDocumentHandler
} from '../kyc-docs/kyc-docs.handler';

export const adminKycDocsRoute = new Hono<HonoEnv>()
  .get('/:id/file-url', (c) => getAdminKycDocumentFileUrlHandler(c))
  .patch('/:id', (c) => updateAdminKycDocumentHandler(c))
  .post('/:id/review', (c) => reviewAdminKycDocumentHandler(c));
