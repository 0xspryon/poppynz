import { describe, expect, it } from 'bun:test';
import {
  dummyContract,
  DBNotFoundError,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type Contract,
  type User
} from '@repo/db';
import { makeMailerTest, type ContractBillingNoticeMail } from '@repo/mail';
import { NoopNotificationHubTest } from '@repo/notify';
import { Effect, Layer } from 'effect';
import { copyFor, cycleDates, sendBillingNotice, type BillingNoticeKind } from './notices';

const nbsp = ' ';

const contract: Contract = {
  ...dummyContract,
  id: 'contract-1',
  familyUserId: 'family-1',
  providerUserId: 'helper-1',
  status: 'active'
};

const cycle = { startsOn: '2026-11-02', endsOn: '2026-11-04' };

const user = (id: string): User =>
  ({ id, name: id, email: `${id}@example.test`, role: 'family' }) as unknown as User;

/** Profiles by user id; a missing entry is a failed lookup. */
const world = (languages: Record<string, string | undefined>) => {
  const mails: Array<ContractBillingNoticeMail> = [];
  const layer = Layer.mergeAll(
    makeUserRepoTest({
      findById: (id) => Effect.succeed(user(id)),
      findByEmail: () => Effect.die('unused')
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('unused'),
      findByUserId: (userId) =>
        userId in languages
          ? Effect.succeed({
              userId,
              firstName: userId === 'family-1' ? 'Fam' : 'Sam',
              lastName: userId === 'family-1' ? 'Ily' : 'Taylor',
              language: languages[userId]
            } as never)
          : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      updateByUserId: () => Effect.die('unused'),
      updateLocationByUserId: () => Effect.die('unused')
    }),
    makeMailerTest({
      sendContractBillingNotice: (mail) => Effect.sync(() => void mails.push(mail))
    }),
    NoopNotificationHubTest
  );
  const send = (
    kind: BillingNoticeKind,
    parties: ReadonlyArray<'family' | 'helper'>,
    extra: Partial<Parameters<typeof sendBillingNotice>[2]> = {}
  ) =>
    Effect.runPromise(
      sendBillingNotice(kind, parties, { contract, cycle, ...extra }).pipe(Effect.provide(layer))
    );
  return { mails, send };
};

describe('sendBillingNotice locale', () => {
  it("writes each party's mail in their own profile language", async () => {
    const { mails, send } = world({ 'family-1': 'fr', 'helper-1': 'en' });

    await send('resumed', ['family', 'helper'], { amountCents: 13206, helperAmountCents: 10531 });

    const family = mails.find((mail) => mail.email === 'family-1@example.test')!;
    expect(family.locale).toBe('fr');
    expect(family.subject).toBe('Votre contrat a repris');
    expect(family.paragraphs[0]).toBe(
      `Votre contrat avec Sam T. a repris${nbsp}: un montant de 132,06${nbsp}$ a été facturé pour le reste de la période (lun. 2 nov. – mer. 4 nov.).`
    );
    expect(family.linkLabel).toBe('Voir le contrat');
    expect(family.link).toBe('https://app.poppynz.com/family/contracts/contract-1');

    const helper = mails.find((mail) => mail.email === 'helper-1@example.test')!;
    expect(helper.locale).toBe('en');
    expect(helper.subject).toBe('Your contract has resumed');
    expect(helper.paragraphs[0]).toBe(
      'Your contract with Fam I. has resumed: $105.31 was received for the rest of Mon, Nov 2 – Wed, Nov 4.'
    );
  });

  it('falls back to English when the profile lookup fails, and still sends', async () => {
    const { mails, send } = world({});

    await send('charge_failed', ['family'], { amountCents: 13206 });

    expect(mails).toHaveLength(1);
    expect(mails[0]!.locale).toBe('en');
    expect(mails[0]!.subject).toBe('We still could not charge your card');
  });

  it('keeps the button pointing at the right page in French', async () => {
    const { mails, send } = world({ 'family-1': 'fr', 'helper-1': 'fr' });

    await send('helper_not_ready', ['helper', 'family']);
    await send('hold_declined', ['family'], { amountCents: 13206 });

    const links = mails.map((mail) => [mail.linkLabel, mail.link]);
    expect(links).toEqual([
      ['Corriger les versements', 'https://app.poppynz.com/service-provider/payouts'],
      ['Voir le contrat', 'https://app.poppynz.com/family/contracts/contract-1'],
      ['Mettre à jour votre carte', 'https://app.poppynz.com/family/billing']
    ]);
  });
});

describe('copyFor', () => {
  const kinds: Array<BillingNoticeKind> = [
    'readiness_reminder',
    'cancelled_not_ready',
    'hold_declined',
    'payment_pending',
    'suspended',
    'resumed',
    'helper_not_ready',
    'charge_failed'
  ];
  const englishLeftovers = /\b(the|your|you|and|with|payout|card|contract)\b/i;

  for (const kind of kinds) {
    for (const party of ['family', 'helper'] as const) {
      it(`${kind} (${party}) has French copy wherever it has English copy`, () => {
        const context = { contract, cycle, amountCents: 12500, startsOn: '2026-11-02' };
        const english = copyFor(kind, party, context, 'Sam T.', 'en');
        const french = copyFor(kind, party, context, 'Sam T.', 'fr');
        expect(french === null).toBe(english === null);
        if (!english || !french) return;
        expect(french.link).toBe(english.link);
        for (const text of [french.subject, french.linkLabel, ...french.paragraphs]) {
          expect(text).not.toMatch(englishLeftovers);
          expect(text).not.toContain("'");
          expect(text).not.toMatch(/ :/);
        }
      });
    }
  }

  it('formats amounts and dates in fr-CA', () => {
    const copy = copyFor(
      'hold_declined',
      'family',
      { contract, cycle, amountCents: 12500 },
      'Sam T.',
      'fr'
    )!;
    expect(copy.paragraphs[0]).toBe(
      `Nous n’avons pas pu effectuer la préautorisation de 125,00${nbsp}$ pour vos services avec Sam T. (lun. 2 nov. – mer. 4 nov.).`
    );
  });

  it('keeps cycle dates English by default (admin alerts, descriptions)', () => {
    expect(cycleDates(cycle)).toBe('Mon, Nov 2 – Wed, Nov 4');
    expect(cycleDates({ startsOn: '2026-11-02', endsOn: '2026-11-02' })).toBe('Mon, Nov 2');
  });
});
