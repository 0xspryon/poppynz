import {
  DBNotFoundError,
  dummyContractAgreementSignature,
  emptyTcDocumentRepo,
  makeContractAgreementRepoTest,
  makeSessionRepoTest,
  makeTcDocumentRepoTest,
  makeUserRepoTest,
  type TcDocument,
  type TcDocumentVersion,
  type User
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  createTcDraftRouteProgram,
  deleteTcDocumentRouteProgram,
  getAdminTcRouteProgram,
  listAgreementSignaturesRouteProgram,
  previewTcTemplateRouteProgram,
  publishTcDraftRouteProgram,
  updateTcDraftRouteProgram
} from './tcs.handler';

/** Admin editing and versioning of the service agreement template (UAT
 * round 2, item 4) — the T&C editor with placeholder validation. */

const at = new Date('2026-10-01T00:00:00.000Z');

const admin: User = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@example.com',
  emailVerified: true,
  image: null,
  createdAt: at,
  updatedAt: at,
  isAnonymous: false,
  role: 'admin',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
};

const agreementDoc: TcDocument = {
  id: 'agreement-doc',
  slug: 'service_agreement',
  title: 'Service Agreement (Draft — pending legal review)',
  appliesToRole: 'all',
  kind: 'service_agreement',
  deletedAt: null,
  createdAt: at,
  updatedAt: at
};
const termsDoc: TcDocument = {
  ...agreementDoc,
  id: 'tos-doc',
  slug: 'terms_of_service',
  kind: 'terms'
};

const row = (overrides: Partial<TcDocumentVersion> = {}): TcDocumentVersion => ({
  id: 'agreement-v1-en',
  documentId: 'agreement-doc',
  locale: 'en',
  version: 1,
  description: 'Default',
  content: 'Between {{family.name}} and {{helper.name}}.',
  checkboxLabel: 'I have read and agree.',
  publishedAt: at,
  createdAt: at,
  updatedAt: at,
  ...overrides
});

const makeLayer = (
  options: { versions?: Array<TcDocumentVersion>; allowed?: (permissions: unknown) => boolean } = {}
) => {
  const documents = [agreementDoc, termsDoc];
  const versions = options.versions ?? [row()];
  const findDocument = (id: string) => {
    const found = documents.find((document) => document.id === id && document.deletedAt === null);
    return found
      ? Effect.succeed(found)
      : Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: id }));
  };
  const draftOf = (documentId: string, locale: string) =>
    versions.find(
      (candidate) =>
        candidate.documentId === documentId &&
        candidate.locale === locale &&
        candidate.publishedAt === null
    );
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: admin.id }, session: { id: 'session-1' } }),
      userHasPermission: (_headers, permissions) =>
        Effect.succeed(options.allowed ? options.allowed(permissions) : true)
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(admin),
      findByEmail: () => Effect.succeed(admin)
    }),
    makeSessionRepoTest({
      findById: () =>
        Effect.succeed({
          id: 'session-1',
          expiresAt: new Date('2099-01-01'),
          token: 'token',
          createdAt: at,
          updatedAt: at,
          ipAddress: null,
          userAgent: null,
          userId: admin.id,
          impersonatedBy: null,
          activeOrganizationId: null
        })
    }),
    makeTcDocumentRepoTest({
      ...emptyTcDocumentRepo,
      findActiveById: findDocument,
      listVersions: (documentId) =>
        Effect.succeed(
          versions
            .filter((candidate) => candidate.documentId === documentId)
            .sort((a, b) => b.version - a.version)
        ),
      createDraft: (documentId, input) => {
        const draft = row({ ...input, id: `draft-${input.locale}`, documentId, publishedAt: null });
        versions.push(draft);
        return Effect.succeed(draft);
      },
      updateDraft: (documentId, input, locale = 'en') => {
        const draft = draftOf(documentId, locale);
        if (!draft)
          return Effect.fail(
            new DBNotFoundError({ entity: 'tcDocumentVersion', value: documentId })
          );
        Object.assign(draft, input);
        return Effect.succeed(draft);
      },
      publishDraft: (documentId, locale = 'en') => {
        const draft = draftOf(documentId, locale);
        if (!draft)
          return Effect.fail(
            new DBNotFoundError({ entity: 'tcDocumentVersion', value: documentId })
          );
        draft.publishedAt = new Date('2026-10-26T00:00:00.000Z');
        return Effect.succeed(draft);
      },
      softDeleteDocument: (id) =>
        findDocument(id).pipe(
          Effect.tap((document) => Effect.sync(() => (document.deletedAt = at)))
        )
    }),
    makeContractAgreementRepoTest({
      listRecent: () =>
        Effect.succeed([
          {
            ...dummyContractAgreementSignature(),
            signerName: 'Priya Tester',
            signerEmail: 'priya@example.com'
          }
        ])
    })
  );
};

const withBody = (body: unknown) =>
  ({ req: { json: async () => body } }) as unknown as HonoContext<HonoEnv>;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const draftInput = (content: string) => ({
  description: 'Clarify cancellations',
  content,
  checkboxLabel: 'I have read and agree.'
});

describe('admin editing of the service agreement template', () => {
  it('saves and publishes a valid draft as the next version', async () => {
    const layer = makeLayer();
    const draft = await Effect.runPromise(
      createTcDraftRouteProgram(
        withBody(draftInput('{{#services}}- {{name}}\n{{/services}}')),
        new Headers(),
        'agreement-doc'
      ).pipe(Effect.provide(layer))
    );
    expect(draft).toMatchObject({ version: 2, locale: 'en', publishedAt: null });
    const published = await Effect.runPromise(
      publishTcDraftRouteProgram(new Headers(), 'agreement-doc').pipe(Effect.provide(layer))
    );
    expect(published.version).toBe(2);
    const document = await Effect.runPromise(
      getAdminTcRouteProgram(new Headers(), 'agreement-doc').pipe(Effect.provide(layer))
    );
    expect(document).toMatchObject({ kind: 'service_agreement' });
    expect(document.versions.map((version) => version.version)).toEqual([2, 1]);
  });

  it('refuses to save a draft naming an unknown placeholder, with its line', async () => {
    const exit = await Effect.runPromiseExit(
      createTcDraftRouteProgram(
        withBody(draftInput('Hello\n{{family.nmae}}')),
        new Headers(),
        'agreement-doc'
      ).pipe(Effect.provide(makeLayer()))
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'TcTemplateInvalidError',
      issues: [{ code: 'unknown_placeholder', name: 'family.nmae', line: 2 }]
    });
  });

  it('refuses an edit that breaks the open draft, and leaves it unchanged', async () => {
    const versions = [row(), row({ id: 'draft-en', version: 2, publishedAt: null, content: 'ok' })];
    const exit = await Effect.runPromiseExit(
      updateTcDraftRouteProgram(
        withBody({ content: '{{#services}}unclosed' }),
        new Headers(),
        'agreement-doc'
      ).pipe(Effect.provide(makeLayer({ versions })))
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'TcTemplateInvalidError',
      issues: [{ code: 'unclosed_section', name: 'services', line: 1 }]
    });
    expect(versions[1]?.content).toBe('ok');
  });

  it('does not apply placeholder rules to ordinary terms documents', async () => {
    const draft = await Effect.runPromise(
      createTcDraftRouteProgram(
        withBody(draftInput('Literal {{braces}} in the terms')),
        new Headers(),
        'tos-doc'
      ).pipe(Effect.provide(makeLayer()))
    );
    expect(draft.content).toBe('Literal {{braces}} in the terms');
  });

  it('previews a draft with sample data in its language, and lists the placeholders', async () => {
    const preview = await Effect.runPromise(
      previewTcTemplateRouteProgram(
        withBody({
          content: 'Entre {{family.name}}, débute le {{contract.startsOn}}.',
          locale: 'fr'
        }),
        new Headers(),
        'agreement-doc'
      ).pipe(Effect.provide(makeLayer()))
    );
    expect(preview.issues).toEqual([]);
    expect(preview.content).toBe('Entre Priya Sample, débute le lundi 5 janvier 2099.');
    expect(preview.placeholders).toContainEqual({
      name: 'family.name',
      kind: 'text',
      within: null
    });
    expect(preview.placeholders).toContainEqual({ name: 'rate', kind: 'text', within: 'services' });
  });

  it('previews an invalid draft as its issues, without text', async () => {
    const preview = await Effect.runPromise(
      previewTcTemplateRouteProgram(
        withBody({ content: '{{nope}}' }),
        new Headers(),
        'agreement-doc'
      ).pipe(Effect.provide(makeLayer()))
    );
    expect(preview).toMatchObject({
      content: null,
      issues: [{ code: 'unknown_placeholder', name: 'nope', line: 1 }]
    });
  });

  it('never removes the service agreement', async () => {
    const exit = await Effect.runPromiseExit(
      deleteTcDocumentRouteProgram(new Headers(), 'agreement-doc').pipe(Effect.provide(makeLayer()))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'TcDocumentProtectedError' });
  });

  it('needs the T&C write permission to preview', async () => {
    const exit = await Effect.runPromiseExit(
      previewTcTemplateRouteProgram(
        withBody({ content: 'x' }),
        new Headers(),
        'agreement-doc'
      ).pipe(Effect.provide(makeLayer({ allowed: () => false })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});

describe('admin list of agreement signatures', () => {
  it('lists recent signatures without their text', async () => {
    const signatures = await Effect.runPromise(
      listAgreementSignaturesRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(signatures).toEqual([
      expect.objectContaining({ side: 'family', signerName: 'Priya Tester', templateVersion: 1 })
    ]);
    expect(signatures[0]).not.toHaveProperty('content');
  });

  it('needs the contract review permission as well as T&C write', async () => {
    const exit = await Effect.runPromiseExit(
      listAgreementSignaturesRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            allowed: (permissions) => !(permissions as { contract?: unknown }).contract
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});
