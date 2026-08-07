// Typed catalogue of realtime notifications. This module is transport-free on
// purpose: the web app imports it type-only, so adding an event here is all a
// new domain needs to ride the existing SSE channel — e.g. a future
// "contract.updated" or "approval.decided" is one more entry in this map plus
// a publish() call at its mutation site.

export type NotificationPayloads = {
  /** Someone sent the viewer a new reach-out. */
  "conversation.reachout": {
    conversationId: string;
    senderName: string;
  };
  /** The receiver responded — the conversation is unlocked for the initiator. */
  "conversation.unlocked": {
    conversationId: string;
    responderName: string;
  };
  /** A new chat message landed in one of the viewer's conversations. */
  "conversation.message": {
    conversationId: string;
    messageId: string;
    senderUserId: string;
    senderName: string;
    preview: string;
  };
  /** An admin decided the viewer's approval request. */
  "approval.decided": {
    approvalRequestId: string;
    status: "approved" | "rejected";
    reason: string | null;
    expiresAt: string | null;
  };
  /** A previously granted approval was revoked before its expiry. */
  "approval.revoked": {
    approvalId: string;
    reason: string | null;
  };
  /** The counterpart proposed contract terms — the initial proposal, a re-send
   * after decline/changes, or (isAmendment) new terms on an active contract. */
  "contract.proposed": {
    contractId: string;
    counterpartName: string;
    isAmendment: boolean;
  };
  /** The counterpart accepted the viewer's proposed terms. */
  "contract.accepted": {
    contractId: string;
    counterpartName: string;
    isAmendment: boolean;
  };
  /** The counterpart declined the viewer's proposed terms. */
  "contract.declined": {
    contractId: string;
    counterpartName: string;
    reason: string | null;
    isAmendment: boolean;
  };
  /** The provider asked the family to revise the proposal in chat. */
  "contract.changes_requested": {
    contractId: string;
    counterpartName: string;
  };
  /** The counterpart gave 2 weeks' notice; endsOn is the last working day. */
  "contract.ended": {
    contractId: string;
    counterpartName: string;
    endsOn: string;
  };
};

// Planned (not yet published) — future domains follow the same pattern:
// "approval.expiring" with { approvalId, expiresAt }.

export type NotificationType = keyof NotificationPayloads;

/** What a publisher hands to the hub — the envelope is stamped centrally. */
export type NotificationInput<T extends NotificationType = NotificationType> = {
  [K in NotificationType]: { type: K; payload: NotificationPayloads[K] };
}[T];

/** The envelope delivered to subscribers (and over SSE as JSON). */
export type AppNotification<T extends NotificationType = NotificationType> = {
  [K in NotificationType]: {
    id: string;
    type: K;
    createdAt: string;
    payload: NotificationPayloads[K];
  };
}[T];
