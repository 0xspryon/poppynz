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

/** Makes `card` the user's one card on file. The card it replaces is
 * detached at the gateway — best-effort: a card left attached is harmless,
 * failing a settled payment over it is not. Null when the user has no
 * customer row (helpers never do). */
export const saveCard = (userId: string, card: CardDetails) =>
  Effect.gen(function* () {
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const before = yield* repo.findByUserId(userId);
    if (before === null) return null;
    if (before.cardReference === card.reference) return before;
    const after = yield* repo.setCard(userId, {
      reference: card.reference,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear
    });
    if (before.cardReference !== null && before.provider === payments.provider) {
      yield* payments
        .removeCard(before.cardReference)
        .pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`could not detach replaced card for ${userId}`, error)
          )
        );
    }
    return after;
  });

export type CardSetupResult =
  | { outcome: 'saved'; card: BillingCard }
  /** Not a setup of ours, or of another user's customer. */
  | { outcome: 'not_found' }
  /** Ours, but not finished (or finished without a card). */
  | { outcome: 'incomplete' };

/** Applies a card setup the browser (or the webhook) says finished: re-fetch
 * it, check it belongs to `userId` when one is given, and make its card the
 * card on file. */
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
      return { outcome: 'not_found' as const };
    }
    if (setup.status !== 'succeeded' || setup.paymentMethod === null) {
      return { outcome: 'incomplete' as const };
    }
    yield* saveCard(owner.userId, setup.paymentMethod);
    const { reference: cardReference, brand, last4, expMonth, expYear } = setup.paymentMethod;
    return {
      outcome: 'saved' as const,
      card: { reference: cardReference, brand, last4, expMonth, expYear }
    };
  });
