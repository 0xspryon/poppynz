import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  getAdminApprovalRequestHandler,
  listAdminApprovalRequestsHandler,
  rejectAdminApprovalRequestHandler
} from '../approval-requests/approval-requests.handler';

export const adminApprovalRequestsRoute = new Hono<HonoEnv>()
  .get('/', (c) => listAdminApprovalRequestsHandler(c))
  .get('/:id', (c) => getAdminApprovalRequestHandler(c))
  .post('/:id/reject', (c) => rejectAdminApprovalRequestHandler(c));
