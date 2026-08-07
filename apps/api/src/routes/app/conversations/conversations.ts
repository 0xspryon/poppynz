import { Hono } from 'hono';
import type { HonoEnv } from '../../../app-env';
import {
  createReachoutHandler,
  getConversationHandler,
  ignoreReachoutHandler,
  listConversationsHandler,
  lookupConversationHandler,
  markConversationReadHandler,
  respondToReachoutHandler,
  sendMessageHandler,
  unreadCountHandler
} from './conversations.handler';

// Literal routes go before "/:id" so "me/unread-count" and "lookup" never
// match as conversation ids.
export const conversationsRoute = new Hono<HonoEnv>()
  .get('/', (c) => listConversationsHandler(c))
  .post('/', (c) => createReachoutHandler(c))
  .get('/me/unread-count', (c) => unreadCountHandler(c))
  .get('/lookup', (c) => lookupConversationHandler(c))
  .get('/:id', (c) => getConversationHandler(c))
  .post('/:id/respond', (c) => respondToReachoutHandler(c))
  .post('/:id/ignore', (c) => ignoreReachoutHandler(c))
  .post('/:id/messages', (c) => sendMessageHandler(c))
  .post('/:id/read', (c) => markConversationReadHandler(c));
