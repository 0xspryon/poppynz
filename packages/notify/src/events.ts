// Typed catalogue of realtime notifications. This module is transport-free on
// purpose: the web app imports it type-only, so adding an event here is all a
// new domain needs to ride the existing SSE channel — e.g. a future
// "contract.updated" or "approval.decided" is one more entry in this map plus
// a publish() call at its mutation site.

export type NotificationPayloads = {
  /** Someone sent the viewer a new reach-out. */
  'conversation.reachout': {
    conversationId: string;
    senderName: string;
  };
  /** The receiver responded — the conversation is unlocked for the initiator. */
  'conversation.unlocked': {
    conversationId: string;
    responderName: string;
  };
  /** A new chat message landed in one of the viewer's conversations. */
  'conversation.message': {
    conversationId: string;
    messageId: string;
    senderUserId: string;
    senderName: string;
    preview: string;
    /** Contact details detected in the message (UAT #38) — the recipient
     * is warned too. Absent on events from before the warning existed. */
    contactWarning?: Array<'phone' | 'email' | 'link'> | null;
  };
  /** An admin decided the viewer's approval request. */
  'approval.decided': {
    approvalRequestId: string;
    status: 'approved' | 'rejected';
    reason: string | null;
    expiresAt: string | null;
  };
  /** A previously granted approval was revoked before its expiry. */
  'approval.revoked': {
    approvalId: string;
    reason: string | null;
  };
  /** The counterpart proposed contract terms — the initial proposal or a
   * re-send after decline/changes. Signed contracts are never amended. */
  'contract.proposed': {
    contractId: string;
    counterpartName: string;
  };
  /** The counterpart accepted the viewer's proposed terms. */
  'contract.accepted': {
    contractId: string;
    counterpartName: string;
  };
  /** The counterpart declined the viewer's proposed terms. */
  'contract.declined': {
    contractId: string;
    counterpartName: string;
    reason: string | null;
  };
  /** The provider asked the family to revise the proposal in chat. */
  'contract.changes_requested': {
    contractId: string;
    counterpartName: string;
  };
  /** The counterpart gave 2 weeks' notice; endsOn is the effective last
   * working day (the earlier of notice + 14 days and the negotiated end), and
   * endsAtMinutes that day's end time when the negotiated end wins and has one. */
  'contract.ended': {
    contractId: string;
    counterpartName: string;
    endsOn: string;
    endsAtMinutes: number | null;
  };
  /** The viewer's safety check moved: its payment settled (payment_pending —
   * the order is being placed) or failed (not_started — back to the basket),
   * Credibled set it up (invited), is processing it, finished it (awaiting
   * review), or an admin decided. Deliberately thin — a page showing the
   * verification refetches its summary on receipt; anywhere else it is just a
   * toast (payment events have no toast: the payer is on the page). */
  'safety_verification.updated': {
    status:
      | 'not_started'
      | 'payment_pending'
      | 'invited'
      | 'in_progress'
      | 'review_required'
      | 'verified'
      | 'rejected';
  };
  /** Something changed in a contract's billing the viewer should see (a hold
   * declined, a suspension, a resume, a cancellation). Thin on purpose: an
   * open contract or billing page refetches. */
  'contract.billing': {
    contractId: string;
    kind:
      | 'readiness_reminder'
      | 'cancelled_not_ready'
      | 'hold_declined'
      | 'payment_pending'
      | 'suspended'
      | 'resumed'
      | 'helper_not_ready'
      | 'charge_failed';
  };
  /** Something happened to one of the contract's sessions (Tier 3): a
   * cancellation, day off, report or dispute was recorded, answered,
   * confirmed by silence, lapsed or decided by an admin. Thin on purpose: an
   * open contract or cycle page refetches. */
  'contract.session': {
    contractId: string;
    cycleId: string;
    sessionId: string;
    resolutionId: string;
    event: 'recorded' | 'confirmed' | 'contested' | 'declined' | 'lapsed' | 'decided';
  };
  /** Someone asked the viewer to vouch for them. */
  'vouch.requested': {
    vouchId: string;
    applicantName: string;
  };
  /** One of the viewer's own vouch requests moved. Deliberately empty — the
   * applicant must never learn which voucher was flagged or why; the page
   * refetches its generic list. */
  'vouch.updated': Record<string, never>;
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
