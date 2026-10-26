/**
 * The written service agreement (UAT round 2, item 4): rendering the admin's
 * template from a contract version's terms, and turning a party's explicit
 * "I have read and agree" into the signature row stored with Sign & send
 * (family) and Accept & sign (helper).
 *
 * Both signatures attach to the same contract version. The helper signs the
 * template revision the family signed (in the helper's language when that
 * revision is translated), so both read the same agreement; each signature
 * keeps the exact text its signer was shown and its SHA-256. The client
 * echoes the template row and hash it displayed, and signing re-renders and
 * compares — a template publish, a profile change or a fee change between
 * reading and signing fails with AgreementChangedError instead of recording
 * a text nobody saw.
 */
import { createHash } from 'node:crypto';
import type { SqlError } from '@effect/sql/SqlError';
import { CYCLE_DAYS, END_NOTICE_DAYS, contractBillingPolicy, loadTaxSnapshot } from '@repo/billing';
import {
  applyBps,
  computeSupplyTax,
  normaliseProvince,
  weeklyServiceCents,
  type TaxSnapshot
} from '@repo/billing/pricing';
import { zoneLabel } from '@repo/calendar';
import {
  agreementTemplateSchema,
  currentRevision,
  formatAgreementDate,
  formatAgreementDay,
  formatAgreementHours,
  formatAgreementMoney,
  formatAgreementPercent,
  formatAgreementTime,
  formatAgreementWeekday,
  renderTemplate,
  TcDocumentRepo,
  toTcLocale,
  UserProfileRepo,
  UserRepo,
  validateTemplate,
  type Contract,
  type ContractAgreementSignatureInput,
  type ContractServiceItem,
  type ContractVersion,
  type TcDocument,
  type TcDocumentVersion,
  type TcLocale,
  type TemplateValues
} from '@repo/db';
import { Data, Effect } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { handleNever, type UserAndSession } from '@/api/lib/effect-auth';

/** No published service agreement to sign, or one that can't be rendered
 * (it names an unknown placeholder, or the terms can't be priced). */
export class AgreementUnavailableError extends Data.TaggedError('AgreementUnavailableError')<{
  reason: 'no_template' | 'template_invalid' | 'pricing';
}> {}

/** What the signer displayed is no longer what would be signed. */
export class AgreementChangedError extends Data.TaggedError('AgreementChangedError')<{}> {}

/** An admin impersonating a member may look, but never sign for them. */
export class AgreementImpersonationError extends Data.TaggedError(
  'AgreementImpersonationError'
)<{}> {}

export class AgreementRepoError extends Data.TaggedError('AgreementRepoError')<{
  cause: SqlError;
}> {}

/** The template row and text hash the signer displayed and agreed to. */
export type AgreementAssent = { versionId: string; sha256: string };

export const TERMS_OF_SERVICE_SLUG = 'terms_of_service';

/**
 * Hours before a cycle starts that its hold is placed, when the billing
 * settings don't carry it — mirrors `holdAt = cycle start − 2 days` in
 * @repo/billing's schedule. Once the hold lead is a setting
 * (`holdLeadHours`, CONTRACT_HOLD_LEAD_HOURS) the agreement states that.
 */
export const HOLD_LEAD_HOURS = 48;

const holdLeadHoursOf = (policy: object) => {
  const configured = (policy as { holdLeadHours?: unknown }).holdLeadHours;
  return typeof configured === 'number' ? configured : HOLD_LEAD_HOURS;
};

export const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export const mapAgreementRepoError = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
  effect.pipe(
    Effect.catchTag('SqlError', (cause) => Effect.fail(new AgreementRepoError({ cause })))
  );

/** The terms being signed: a version's, with the zone they are read in
 * (stamped at send for a draft). */
export type AgreementTerms = Pick<
  ContractVersion,
  'version' | 'services' | 'startsOn' | 'endsOn' | 'endsAtMinutes'
> & { timeZone: string };

export type AgreementParty = { name: string; city: string | null; province: string | null };

type TaxLineValue = { label: string; amount: string };

export type AgreementPricing = {
  serviceCents: number;
  careTaxes: Array<{ label: string; taxCents: number }>;
  feeCents: number;
  feeTaxes: Array<{ label: string; taxCents: number }>;
  commissionCents: number;
  commissionTaxes: Array<{ label: string; taxCents: number }>;
};

export type AgreementValuesInput = {
  locale: TcLocale;
  templateVersion: number;
  contractId: string;
  terms: AgreementTerms;
  family: AgreementParty;
  helper: AgreementParty;
  pricing: AgreementPricing;
  familyFeeBps: number;
  providerCommissionBps: number;
  retryHours: number;
  holdLeadHours: number;
  cancellationPolicy: { title: string; version: number; publishedAt: Date | null } | null;
};

const sum = (lines: ReadonlyArray<{ taxCents: number }>) =>
  lines.reduce((total, line) => total + line.taxCents, 0);

const minutesOf = (session: { startMinutes: number; endMinutes: number }) =>
  session.endMinutes - session.startMinutes;

const location = (party: AgreementParty) =>
  [party.city, party.province].filter((part) => part && part.trim() !== '').join(', ');

/** The placeholder values for one contract version, formatted in `locale`.
 * Pure: everything it needs is passed in, so the text is reproducible. */
export const agreementValues = (input: AgreementValuesInput): TemplateValues => {
  const { locale, terms, pricing } = input;
  const currency = terms.services[0]?.currency ?? 'CAD';
  const money = (cents: number) => formatAgreementMoney(cents, locale, currency);
  const time = (minutes: number) => formatAgreementTime(minutes, locale);
  const taxes = (lines: AgreementPricing['careTaxes']): Array<TaxLineValue> =>
    lines
      .filter((line) => line.taxCents > 0)
      .map((line) => ({ label: line.label, amount: money(line.taxCents) }));
  const sessionValues = (session: ContractServiceItem['sessions'][number]) => ({
    day: formatAgreementWeekday(session.weekday, locale),
    start: time(session.startMinutes),
    end: time(session.endMinutes),
    hours: formatAgreementHours(minutesOf(session), locale)
  });
  const ordered = <S extends { weekday: number; startMinutes: number }>(
    sessions: ReadonlyArray<S>
  ) => [...sessions].sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes);
  const weeklyMinutes = terms.services.reduce(
    (total, service) =>
      total + service.sessions.reduce((acc, session) => acc + minutesOf(session), 0),
    0
  );
  const careTax = sum(pricing.careTaxes);
  const unset = '—';
  return {
    'agreement.version': String(input.templateVersion),
    'agreement.language': locale === 'fr' ? 'Français' : 'English',
    'contract.reference': input.contractId,
    'contract.version': String(terms.version),
    'contract.startsOn': terms.startsOn ? formatAgreementDate(terms.startsOn, locale) : unset,
    'contract.hasEndDate': terms.endsOn !== null,
    'contract.endsOn': terms.endsOn ? formatAgreementDate(terms.endsOn, locale) : '',
    'contract.endsAt': terms.endsOn
      ? terms.endsAtMinutes !== null
        ? time(terms.endsAtMinutes)
        : locale === 'fr'
          ? 'la fin de la journée'
          : 'the end of the day'
      : '',
    'contract.timeZone': zoneLabel(terms.timeZone, locale === 'fr' ? 'fr-CA' : 'en-CA'),
    'contract.currency': currency,
    'family.name': input.family.name,
    'family.city': input.family.city ?? '',
    'family.province': input.family.province ?? '',
    'family.location': location(input.family),
    'helper.name': input.helper.name,
    'helper.city': input.helper.city ?? '',
    'helper.province': input.helper.province ?? '',
    'helper.location': location(input.helper),
    services: terms.services.map((service) => ({
      name: service.name,
      rate: money(service.rateCents),
      hasExpectations: service.expectations.trim() !== '',
      expectations: service.expectations.trim(),
      weeklyHours: formatAgreementHours(
        service.sessions.reduce((total, session) => total + minutesOf(session), 0),
        locale
      ),
      weeklyAmount: money(weeklyServiceCents([service])),
      sessions: ordered(service.sessions).map(sessionValues)
    })),
    schedule: ordered(
      terms.services.flatMap((service) =>
        service.sessions.map((session) => ({ ...session, service: service.name }))
      )
    ).map((session) => ({ ...sessionValues(session), service: session.service })),
    'schedule.weeklyHours': formatAgreementHours(weeklyMinutes, locale),
    'fees.weeklyCare': money(pricing.serviceCents),
    'fees.careTaxes': taxes(pricing.careTaxes),
    'fees.familyFeePercent': formatAgreementPercent(input.familyFeeBps, locale),
    'fees.familyFee': money(pricing.feeCents),
    'fees.familyFeeTaxes': taxes(pricing.feeTaxes),
    'fees.familyWeeklyTotal': money(
      pricing.serviceCents + careTax + pricing.feeCents + sum(pricing.feeTaxes)
    ),
    'fees.commissionPercent': formatAgreementPercent(input.providerCommissionBps, locale),
    'fees.commission': money(pricing.commissionCents),
    'fees.commissionTaxes': taxes(pricing.commissionTaxes),
    'fees.helperWeeklyShare': money(
      pricing.serviceCents + careTax - pricing.commissionCents - sum(pricing.commissionTaxes)
    ),
    'billing.cycleDays': String(CYCLE_DAYS),
    'billing.holdLeadHours': String(input.holdLeadHours),
    'billing.retryHours': String(input.retryHours),
    'notice.days': String(END_NOTICE_DAYS),
    'cancellation.policyTitle': input.cancellationPolicy?.title ?? unset,
    'cancellation.policyVersion': input.cancellationPolicy
      ? String(input.cancellationPolicy.version)
      : unset,
    'cancellation.policyPublishedOn': input.cancellationPolicy?.publishedAt
      ? formatAgreementDay(input.cancellationPolicy.publishedAt, locale)
      : unset
  };
};

/** One week of the pattern, priced for both sides by the rules billing
 * uses, with tax as of the start date. Null when it can't be priced. */
export const agreementPricing = (
  snapshot: TaxSnapshot,
  terms: Pick<AgreementTerms, 'services' | 'startsOn'>,
  provinces: { family: string | null; helper: string | null },
  rates: { familyFeeBps: number; providerCommissionBps: number },
  today: string
): AgreementPricing | null => {
  const on = terms.startsOn && terms.startsOn > today ? terms.startsOn : today;
  const taxProvinces = {
    payer: provinces.family,
    contract: provinces.family,
    helper: provinces.helper
  } as Parameters<typeof computeSupplyTax>[0]['provinces'];
  const tax = (
    supplyType: 'care_service_value' | 'family_service_fee' | 'provider_commission',
    baseCents: number
  ) => computeSupplyTax({ snapshot, supplyType, baseCents, on, provinces: taxProvinces });
  const serviceCents = weeklyServiceCents(terms.services);
  const feeCents = applyBps(serviceCents, rates.familyFeeBps);
  const commissionCents = applyBps(serviceCents, rates.providerCommissionBps);
  const care = tax('care_service_value', serviceCents);
  const fee = tax('family_service_fee', feeCents);
  const commission = tax('provider_commission', commissionCents);
  if (!care.ok || !fee.ok || !commission.ok) return null;
  const lines = (result: { lines: ReadonlyArray<{ label: string; taxCents: number }> }) =>
    result.lines.map((line) => ({ label: line.label, taxCents: line.taxCents }));
  return {
    serviceCents,
    careTaxes: lines(care),
    feeCents,
    feeTaxes: lines(fee),
    commissionCents,
    commissionTaxes: lines(commission)
  };
};

const loadParty = (userId: string) =>
  Effect.gen(function* () {
    const profile = yield* UserProfileRepo.pipe(
      Effect.flatMap((repo) => repo.findByUserId(userId)),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
      (errors) => mapAgreementRepoError(errors)
    );
    const user = yield* UserRepo.pipe(
      Effect.flatMap((repo) => repo.findById(userId)),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
      (errors) => mapAgreementRepoError(errors)
    );
    const name =
      [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
      user?.name ||
      'Poppynz member';
    return {
      name,
      city: profile?.city ?? null,
      province: normaliseProvince(profile?.stateProvince, profile?.country)
    } satisfies AgreementParty;
  });

/** The live service agreement and its versions, or AgreementUnavailable. */
export const loadAgreementTemplate = TcDocumentRepo.pipe(
  Effect.flatMap((repo) => repo.findServiceAgreement()),
  (errors) => mapAgreementRepoError(errors),
  Effect.flatMap((found) =>
    found && currentRevision(found.versions)
      ? Effect.succeed(found)
      : Effect.fail(new AgreementUnavailableError({ reason: 'no_template' }))
  )
);

/** The published row of `revision` a reader in `locale` is shown: its
 * translation when published, else the English text (`fallback`). */
const rowOfRevision = (
  versions: ReadonlyArray<TcDocumentVersion>,
  revision: number,
  locale: TcLocale
) => {
  const published = versions.filter((row) => row.version === revision && row.publishedAt !== null);
  const english = published.find((row) => row.locale === 'en') ?? null;
  const translated = published.find((row) => row.locale === locale) ?? null;
  if (translated) return { row: translated, fallback: false };
  return english ? { row: english, fallback: locale !== 'en' } : null;
};

/** The Terms of Service revision in force — its section 10 is the
 * cancellation policy every agreement refers to. Null when none. */
const loadCancellationPolicy = Effect.gen(function* () {
  const repo = yield* TcDocumentRepo;
  const document = yield* repo.findActiveBySlug(TERMS_OF_SERVICE_SLUG).pipe(
    Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
    (errors) => mapAgreementRepoError(errors)
  );
  if (!document) return null;
  const versions = yield* repo
    .listVersions(document.id)
    .pipe((errors) => mapAgreementRepoError(errors));
  const current = currentRevision(versions);
  return current ? { document, version: current } : null;
});

export type RenderedAgreement = {
  document: TcDocument;
  template: TcDocumentVersion;
  fallback: boolean;
  content: string;
  sha256: string;
  cancellationPolicy: { versionId: string; version: number } | null;
};

/**
 * Renders the agreement for `terms`. `revision` pins the template revision
 * (the helper signs what the family signed); null takes the current one.
 * `row` picks the template row by id instead of by locale (signing renders
 * exactly the row the signer displayed).
 */
export const renderContractAgreement = (input: {
  contract: Pick<Contract, 'id' | 'familyUserId' | 'providerUserId'>;
  terms: AgreementTerms;
  locale: TcLocale;
  revision: number | null;
  today: string;
}) =>
  Effect.gen(function* () {
    const { document, versions } = yield* loadAgreementTemplate;
    const current = currentRevision(versions)!.version;
    // A pinned revision always exists (published rows are immutable); the
    // current one is the fallback all the same.
    const shown =
      rowOfRevision(versions, input.revision ?? current, input.locale) ??
      rowOfRevision(versions, current, input.locale);
    if (!shown) return yield* Effect.fail(new AgreementUnavailableError({ reason: 'no_template' }));
    const template = shown.row;
    if (validateTemplate(template.content, agreementTemplateSchema).length > 0) {
      return yield* Effect.fail(new AgreementUnavailableError({ reason: 'template_invalid' }));
    }

    const [family, helper] = yield* Effect.all([
      loadParty(input.contract.familyUserId),
      loadParty(input.contract.providerUserId)
    ]);
    const policy = yield* contractBillingPolicy;
    const snapshot = yield* loadTaxSnapshot.pipe((errors) => mapAgreementRepoError(errors));
    const pricing = agreementPricing(
      snapshot,
      input.terms,
      { family: family.province, helper: helper.province },
      {
        familyFeeBps: policy.familyCommissionBps,
        providerCommissionBps: policy.providerCommissionBps
      },
      input.today
    );
    if (!pricing) return yield* Effect.fail(new AgreementUnavailableError({ reason: 'pricing' }));
    const cancellation = yield* loadCancellationPolicy;

    const content = renderTemplate(
      template.content,
      agreementTemplateSchema,
      agreementValues({
        locale: toTcLocale(template.locale),
        templateVersion: template.version,
        contractId: input.contract.id,
        terms: input.terms,
        family,
        helper,
        pricing,
        familyFeeBps: policy.familyCommissionBps,
        providerCommissionBps: policy.providerCommissionBps,
        retryHours: policy.retryHours,
        holdLeadHours: holdLeadHoursOf(policy),
        cancellationPolicy: cancellation
          ? {
              title: cancellation.document.title,
              version: cancellation.version.version,
              publishedAt: cancellation.version.publishedAt
            }
          : null
      })
    );
    return {
      document,
      template,
      fallback: shown.fallback,
      content,
      sha256: sha256Hex(content),
      cancellationPolicy: cancellation
        ? { versionId: cancellation.version.id, version: cancellation.version.version }
        : null
    } satisfies RenderedAgreement;
  });

/**
 * A party's signature on `terms`: re-renders the agreement from the template
 * row the signer displayed and checks it is still the text they agreed to.
 * Refuses an impersonated session outright.
 */
export const agreementSignature = (input: {
  userAndSession: UserAndSession;
  contract: Pick<Contract, 'id' | 'familyUserId' | 'providerUserId'>;
  side: 'family' | 'helper';
  terms: AgreementTerms;
  assent: AgreementAssent;
  revision: number | null;
  today: string;
}) =>
  Effect.gen(function* () {
    if (input.userAndSession.session.impersonatedBy) {
      return yield* Effect.fail(new AgreementImpersonationError());
    }
    const { versions } = yield* loadAgreementTemplate;
    const displayed = versions.find((row) => row.id === input.assent.versionId);
    const expectedRevision = input.revision ?? currentRevision(versions)!.version;
    if (!displayed || displayed.publishedAt === null || displayed.version !== expectedRevision) {
      return yield* Effect.fail(new AgreementChangedError());
    }
    const rendered = yield* renderContractAgreement({
      contract: input.contract,
      terms: input.terms,
      locale: toTcLocale(displayed.locale),
      revision: expectedRevision,
      today: input.today
    });
    if (rendered.template.id !== displayed.id || rendered.sha256 !== input.assent.sha256) {
      return yield* Effect.fail(new AgreementChangedError());
    }
    return {
      signerUserId: input.userAndSession.user.id,
      signerSide: input.side,
      templateDocumentId: rendered.document.id,
      templateVersionId: rendered.template.id,
      templateVersion: rendered.template.version,
      locale: toTcLocale(rendered.template.locale),
      content: rendered.content,
      contentSha256: rendered.sha256,
      cancellationPolicyVersionId: rendered.cancellationPolicy?.versionId ?? null,
      cancellationPolicyVersion: rendered.cancellationPolicy?.version ?? null
    } satisfies ContractAgreementSignatureInput;
  });

export type AgreementError =
  | AgreementUnavailableError
  | AgreementChangedError
  | AgreementImpersonationError
  | AgreementRepoError;

/** The agreement failures as API errors, shared by the contract routes. */
export const agreementErrorToResponse = (c: HonoContext<HonoEnv>, error: AgreementError) => {
  switch (error._tag) {
    case 'AgreementUnavailableError':
      return c.json(
        {
          error: {
            code: 'AGREEMENT_UNAVAILABLE' as const,
            message:
              "The service agreement can't be prepared right now, so nothing can be signed. Try again later.",
            reason: error.reason
          }
        },
        503
      );
    case 'AgreementChangedError':
      return c.json(
        {
          error: {
            code: 'AGREEMENT_CHANGED' as const,
            message:
              'The service agreement changed while you were reading it. Read it again and sign.'
          }
        },
        409
      );
    case 'AgreementImpersonationError':
      return c.json(
        {
          error: {
            code: 'AGREEMENT_SIGNING_IMPERSONATED' as const,
            message: 'Agreements cannot be signed while impersonating. Only the member can sign.'
          }
        },
        403
      );
    case 'AgreementRepoError':
      return c.json(
        {
          error: {
            code: 'AGREEMENT_LOOKUP_FAILED' as const,
            message: 'Unable to load the service agreement.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};
