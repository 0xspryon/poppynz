import { Hono } from 'hono';
import type { HonoEnv } from '../../../app-env';
import {
  acceptContractHandler,
  contractsBadgeCountHandler,
  createContractHandler,
  declineContractHandler,
  endContractHandler,
  getContractHandler,
  listContractsHandler,
  markContractSeenHandler,
  requestChangesHandler,
  saveTermsHandler,
  sendContractHandler,
  withdrawContractHandler
} from './contracts.handler';

// Literal routes go before "/:id" so "me/badge-count" never matches as a
// contract id.
export const contractsRoute = new Hono<HonoEnv>()
  .get('/', (c) => listContractsHandler(c))
  .post('/', (c) => createContractHandler(c))
  .get('/me/badge-count', (c) => contractsBadgeCountHandler(c))
  .get('/:id', (c) => getContractHandler(c))
  .put('/:id/terms', (c) => saveTermsHandler(c))
  .post('/:id/send', (c) => sendContractHandler(c))
  .post('/:id/withdraw', (c) => withdrawContractHandler(c))
  .post('/:id/accept', (c) => acceptContractHandler(c))
  .post('/:id/decline', (c) => declineContractHandler(c))
  .post('/:id/request-changes', (c) => requestChangesHandler(c))
  .post('/:id/end', (c) => endContractHandler(c))
  .post('/:id/seen', (c) => markContractSeenHandler(c));
