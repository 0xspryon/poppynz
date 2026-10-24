import { BillingCustomerRepo, type BillingCard, type BillingCustomer } from '@repo/db';
import { Payments, type CardDetails } from '@repo/payments';
import { Effect } from 'effect';

/** The card on file for a user at the ACTIVE gateway, or null. A card saved
 * under another provider (the mock, before Stripe was switched on) cannot be
 * charged here and does not count. */
export const cardOnFile = (userId: string) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const row = yield* repo.findByUserId(userId);
    return toCard(row, payments.provider);
  });

export const toCard = (row: BillingCustomer | null, provider: string): BillingCard | null =>
  row !== null &&
  row.provider === provider &&
  row.cardReference !== null &&
  row.cardBrand !== null &&
  row.cardLast4 !== null &&
  row.cardExpMonth !== null &&
  row.cardExpYear !== null
    ? {
        reference: row.cardReference,
        brand: row.cardBrand,
        last4: row.cardLast4,
        expMonth: row.cardExpMonth,
        expYear: row.cardExpYear
      }
    : null;

/** The user's gateway customer, created on first use. A row left by another
 * gateway is replaced. */
export const ensureBillingCustomer = (user: { id: string; email: string; name: string }) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const existing = yield* repo.findByUserId(user.id);
    const current = existing !== null && existing.provider === payments.provider ? existing : null;
    if (current !== null) return current;
    const customerReference = yield* payments.ensureCustomer({
      userId: user.id,
      email: user.email,
      name: user.name,
      existing: null
    });
    return yield* repo.upsertCustomer({
      userId: user.id,
      provider: payments.provider,
      customerReference
    });
  });

/** How a card source may treat a different card already on file:
 *  - `replace`: the payer's own explicit choice in the browser (Billing's
 *    confirm) — it supersedes whatever is on file;
 *  - `fill`: a background path (webhook, recovery job, a late settle) that
 *    may be replaying something older than the card on file. It only fills an
 *    empty slot or re-confirms the same card, so a stale source can never
 *    replace — and detach — a newer card. */
export type SaveCardMode = 'replace' | 'fill';

export type SaveCardOutcome =
  /** This call put the card on file. */
  | 'saved'
  /** It already was. */
  | 'unchanged'
  /** Another card stays on file: `fill` found the slot taken, or the
   * compare-and-set lost to a concurrent write. Nothing was detached. */
  | 'kept'
  /** The user has no customer row (helpers never do). */
  | 'no_customer';

/** Makes `card` the user's one card on file. The write is compare-and-set on
 * the card it replaces, and the replaced card is detached at the gateway only
 * when that write won — best-effort: a card left attached is harmless,
 * failing a settled payment over it is not. */
export const saveCard = (userId: string, card: CardDetails, mode: SaveCardMode) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const before = yield* repo.findByUserId(userId);
    if (before === null) return 'no_customer' as SaveCardOutcome;
    if (before.cardReference === card.reference) return 'unchanged' as SaveCardOutcome;
    if (mode === 'fill' && before.cardReference !== null) return 'kept' as SaveCardOutcome;
    const after = yield* repo.setCard(
      userId,
      {
        reference: card.reference,
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear
      },
      before.cardReference
    );
    if (after === null) return 'kept' as SaveCardOutcome;
    if (before.cardReference !== null && before.provider === payments.provider) {
      yield* payments
        .removeCard(before.cardReference)
        .pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`could not detach replaced card for ${userId}`, error)
          )
        );
    }
    return 'saved' as SaveCardOutcome;
  });

export type CardSetupResult =
  | { outcome: 'saved'; card: BillingCard; userId: string }
  /** Another card stays on file (a late webhook, or a concurrent confirm
   * won); `card` is the one on file now. */
  | { outcome: 'kept'; card: BillingCard | null }
  /** Not a setup of ours, or of another user's customer. */
  | { outcome: 'not_found' }
  /** Ours, but not finished (or finished without a card). */
  | { outcome: 'incomplete' };

/** Applies a card setup the browser (or the webhook) says finished: re-fetch
 * it, check it belongs to `userId` when one is given, and make its card the
 * card on file. The browser's confirm (`userId` given) replaces a card
 * already on file; the webhook (`userId` null) does so only for the user's
 * latest setup — any other can be a retry of an older one, so it only fills
 * an empty slot. */
export const applyCardSetup = (reference: string, userId: string | null) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const setup = yield* payments.getCardSetup(reference);
    const owner =
      setup.customer === null
        ? null
        : yield* repo.findByCustomerReference(payments.provider, setup.customer);
    if (owner === null || (userId !== null && owner.userId !== userId)) {
      return { outcome: 'not_found' } as CardSetupResult;
    }
    if (setup.status !== 'succeeded' || setup.paymentMethod === null) {
      return { outcome: 'incomplete' } as CardSetupResult;
    }
    // The browser's confirm replaces; the webhook replaces only for the
    // setup the payer started last (the one being confirmed now) — an older
    // setup may be a stale replay and only fills an empty slot.
    const mode: SaveCardMode =
      userId !== null || owner.latestSetupReference === reference ? 'replace' : 'fill';
    const saved = yield* saveCard(owner.userId, setup.paymentMethod, mode);
    if (saved === 'kept') {
      const current = yield* repo.findByUserId(owner.userId);
      return { outcome: 'kept', card: toCard(current, payments.provider) } as CardSetupResult;
    }
    const { reference: cardReference, brand, last4, expMonth, expYear } = setup.paymentMethod;
    return {
      outcome: 'saved',
      card: { reference: cardReference, brand, last4, expMonth, expYear },
      userId: owner.userId
    } as CardSetupResult;
  });
