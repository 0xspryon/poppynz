/** Messaging: reach-outs and conversations, backed by /conversations.
 * A conversation starts as a templated reach-out; the receiver responds
 * (unlocking chat) or quietly ignores it. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.conversations.$get;
const createEndpoint = apiClient.conversations.$post;
const unreadCountEndpoint = apiClient.conversations.me['unread-count'].$get;
const lookupEndpoint = apiClient.conversations.lookup.$get;
const detailEndpoint = apiClient.conversations[':id'].$get;
const respondEndpoint = apiClient.conversations[':id'].respond.$post;
const ignoreEndpoint = apiClient.conversations[':id'].ignore.$post;
const sendMessageEndpoint = apiClient.conversations[':id'].messages.$post;
const markReadEndpoint = apiClient.conversations[':id'].read.$post;

export type ConversationListData = Extract<
	Awaited<ReturnType<typeof listConversations>>,
	{ ok: true }
>['data'];
export type ConversationSummary = ConversationListData['conversations'][number];
export type ConversationDetailData = Extract<
	Awaited<ReturnType<typeof getConversation>>,
	{ ok: true }
>['data'];
export type ConversationMessage = ConversationDetailData['messages'][number];
export type ConversationLookup = Extract<
	Awaited<ReturnType<typeof lookupConversation>>,
	{ ok: true }
>['data']['conversation'];
export type ReachoutCreateError = ErrorsOf<typeof createEndpoint>;
export type SendMessageError = ErrorsOf<typeof sendMessageEndpoint>;

export async function listConversations() {
	return call(listEndpoint());
}

export async function getUnreadCount() {
	return call(unreadCountEndpoint());
}

export async function lookupConversation(userId: string) {
	// The API reads this via c.req.query (no hono validator), so the RPC input
	// type omits `query` — the client still serializes it at runtime.
	const args = { query: { userId } } as unknown as Parameters<typeof lookupEndpoint>[0];
	return call(lookupEndpoint(args));
}

export async function getConversation(id: string) {
	return call(detailEndpoint({ param: { id } }));
}

export async function createReachout(input: { recipientUserId: string; serviceIds: string[] }) {
	const args = {
		param: {},
		json: input
	} as unknown as Parameters<typeof createEndpoint>[0];
	return call(createEndpoint(args));
}

export async function respondToReachout(id: string) {
	return call(respondEndpoint({ param: { id } }));
}

export async function ignoreReachout(id: string) {
	return call(ignoreEndpoint({ param: { id } }));
}

export async function sendMessage(id: string, body: string) {
	const args = { param: { id }, json: { body } } as unknown as Parameters<
		typeof sendMessageEndpoint
	>[0];
	return call(sendMessageEndpoint(args));
}

export async function markConversationRead(id: string) {
	return call(markReadEndpoint({ param: { id } }));
}

export type { ApiResult };
