import { Hono } from 'hono';
import type { HonoEnv } from '../../../app-env';
import {
  acceptContractHandler,
  contractLandingHandler,
  contractsBadgeCountHandler,
  createContractHandler,
  declineContractHandler,
  endContractHandler,
  getContractCycleHandler,
  getContractHandler,
  listContractsHandler,
  markContractSeenHandler,
  quoteTermsHandler,
  renewContractHandler,
  requestChangesHandler,
  retryContractPaymentHandler,
  saveTermsHandler,
  sendContractHandler,
  withdrawContractHandler
} from './contracts.handler';
import { getAgreementToSignHandler, getSignedAgreementHandler } from './agreement.handler';
import { createReplacementHandler, replacementContextHandler } from './replacement.handler';
import {
  cancelExtraSessionHandler,
  listExtraSessionsHandler,
  proposeExtraSessionHandler,
  quoteExtraSessionHandler,
  respondToExtraSessionHandler,
  withdrawExtraSessionHandler
} from './extra-sessions.handler';
import {
  listPendingSessionResponsesHandler,
  recordSessionActionHandler,
  respondToSessionHandler,
  previewSessionActionHandler
} from './sessions.handler';

// Literal routes go before "/:id" so "me/badge-count" and "me/landing" never
// match as a contract id.
export const contractsRoute = new Hono<HonoEnv>()
  .get('/', (c) => listContractsHandler(c))
  .post('/', (c) => createContractHandler(c))
  .get('/me/badge-count', (c) => contractsBadgeCountHandler(c))
  .get('/me/landing', (c) => contractLandingHandler(c))
  .get('/:id', (c) => getContractHandler(c))
  // A billing cycle, with each session's resolution and the viewer's actions.
  .get('/:id/cycles/:cycleId', (c) => getContractCycleHandler(c))
  // Tier 3 session actions (cancel, day off, reports, disputes, answers).
  .get('/:id/sessions/pending', (c) => listPendingSessionResponsesHandler(c))
  .post('/:id/sessions/:sessionId/actions', (c) => recordSessionActionHandler(c))
  .post('/:id/sessions/:sessionId/respond', (c) => respondToSessionHandler(c))
  // Tier 3 step 2: what an action would do to the session's money.
  .post('/:id/sessions/:sessionId/preview', (c) => previewSessionActionHandler(c))
  // Tier 3 step 3: extra sessions (proposal, answer, withdraw, free cancel).
  .get('/:id/extra-sessions', (c) => listExtraSessionsHandler(c))
  .post('/:id/extra-sessions/quote', (c) => quoteExtraSessionHandler(c))
  .post('/:id/extra-sessions', (c) => proposeExtraSessionHandler(c))
  .post('/:id/extra-sessions/:extraId/respond', (c) => respondToExtraSessionHandler(c))
  .post('/:id/extra-sessions/:extraId/withdraw', (c) => withdrawExtraSessionHandler(c))
  .post('/:id/extra-sessions/:extraId/cancel', (c) => cancelExtraSessionHandler(c))
  .post('/:id/billing/retry', (c) => retryContractPaymentHandler(c))
  .post('/:id/renew', (c) => renewContractHandler(c))
  // Tier 3 step 1b: replace sessions the helper cancelled with another helper.
  .get('/:id/replacement', (c) => replacementContextHandler(c))
  .post('/:id/replacement', (c) => createReplacementHandler(c))
  .get('/:id/agreement', (c) => getAgreementToSignHandler(c))
  .get('/:id/agreement/signed', (c) => getSignedAgreementHandler(c))
  .put('/:id/terms', (c) => saveTermsHandler(c))
  .post('/:id/quote', (c) => quoteTermsHandler(c))
  .post('/:id/send', (c) => sendContractHandler(c))
  .post('/:id/withdraw', (c) => withdrawContractHandler(c))
  .post('/:id/accept', (c) => acceptContractHandler(c))
  .post('/:id/decline', (c) => declineContractHandler(c))
  .post('/:id/request-changes', (c) => requestChangesHandler(c))
  .post('/:id/end', (c) => endContractHandler(c))
  .post('/:id/seen', (c) => markContractSeenHandler(c));
