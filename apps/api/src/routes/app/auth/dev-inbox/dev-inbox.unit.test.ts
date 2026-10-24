import { ConfigProvider, Effect, Exit, Cause, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetDevMagicLinks,
  isDevInboxEnabled,
  rememberDevMagicLink
} from '@/api/lib/dev-magic-links';
import { mountedDevInboxRoute } from './dev-inbox';
import { latestDevMagicLinkRouteProgram } from './dev-inbox.handler';

const withEnv = (entries: Record<string, string>) =>
  Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
const withEnvironment = (environment: string) => withEnv({ ENVIRONMENT: environment });
const devEnv = { ENVIRONMENT: 'dev' };

const failureTag = (exit: Exit.Exit<unknown, { _tag: string }>) => {
  if (!Exit.isFailure(exit)) throw new Error('expected failure');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('expected typed failure');
  return failure.value._tag;
};

describe('dev mock inbox (UAT #32, B10)', () => {
  const savedEnvironment = process.env.ENVIRONMENT;
  const savedNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    forgetDevMagicLinks();
    if (savedEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = savedEnvironment;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  it('returns the latest real link sent to the address', async () => {
    const now = new Date();
    rememberDevMagicLink('Kay@Example.com', 'http://localhost:5173/auth/verify?token=first', now, devEnv);
    rememberDevMagicLink('kay@example.com', 'http://localhost:5173/auth/verify?token=second', now, devEnv);
    const result = await Effect.runPromise(
      latestDevMagicLinkRouteProgram({ email: ' kay@example.com ' }).pipe(withEnvironment('dev'))
    );
    expect(result.link).toBe('http://localhost:5173/auth/verify?token=second');
  });

  it('says so when nothing was sent', async () => {
    const exit = await Effect.runPromiseExit(
      latestDevMagicLinkRouteProgram({ email: 'nobody@example.com' }).pipe(withEnvironment('dev'))
    );
    expect(failureTag(exit)).toBe('DevInboxEmptyError');
  });

  it('does not exist outside dev', async () => {
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=a', new Date(), devEnv);
    for (const environment of ['staging', 'production']) {
      const exit = await Effect.runPromiseExit(
        latestDevMagicLinkRouteProgram({ email: 'kay@example.com' }).pipe(
          withEnvironment(environment)
        )
      );
      expect(failureTag(exit)).toBe('DevInboxUnavailableError');
    }
  });

  it('never stores links outside dev', async () => {
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=a', new Date(), {
      ENVIRONMENT: 'staging'
    });
    const exit = await Effect.runPromiseExit(
      latestDevMagicLinkRouteProgram({ email: 'kay@example.com' }).pipe(withEnvironment('dev'))
    );
    expect(failureTag(exit)).toBe('DevInboxEmptyError');
  });

  it('requires an email', async () => {
    const exit = await Effect.runPromiseExit(
      latestDevMagicLinkRouteProgram({}).pipe(withEnvironment('dev'))
    );
    expect(failureTag(exit)).toBe('RequestValidationError');
  });

  it('fails closed when ENVIRONMENT is unset', async () => {
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=a', new Date(), devEnv);
    const exit = await Effect.runPromiseExit(
      latestDevMagicLinkRouteProgram({ email: 'kay@example.com' }).pipe(withEnv({}))
    );
    expect(failureTag(exit)).toBe('DevInboxUnavailableError');
  });

  it('fails closed when NODE_ENV is production, even with ENVIRONMENT=dev', async () => {
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=a', new Date(), devEnv);
    const exit = await Effect.runPromiseExit(
      latestDevMagicLinkRouteProgram({ email: 'kay@example.com' }).pipe(
        withEnv({ ENVIRONMENT: 'dev', NODE_ENV: 'production' })
      )
    );
    expect(failureTag(exit)).toBe('DevInboxUnavailableError');
  });

  it('never stores links when ENVIRONMENT is unset or NODE_ENV is production', async () => {
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=a', new Date(), {});
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=b', new Date(), {
      ENVIRONMENT: 'dev',
      NODE_ENV: 'production'
    });
    const exit = await Effect.runPromiseExit(
      latestDevMagicLinkRouteProgram({ email: 'kay@example.com' }).pipe(withEnvironment('dev'))
    );
    expect(failureTag(exit)).toBe('DevInboxEmptyError');
  });

  it('guards on an explicit dev ENVIRONMENT and a non-production NODE_ENV', () => {
    expect(isDevInboxEnabled({ ENVIRONMENT: 'dev' })).toBe(true);
    expect(isDevInboxEnabled({ ENVIRONMENT: 'dev', NODE_ENV: 'development' })).toBe(true);
    expect(isDevInboxEnabled({})).toBe(false);
    expect(isDevInboxEnabled({ ENVIRONMENT: 'staging' })).toBe(false);
    expect(isDevInboxEnabled({ ENVIRONMENT: 'dev', NODE_ENV: 'production' })).toBe(false);
  });

  it('only registers the route when the guard passes', async () => {
    const request = () => new Request('http://localhost/dev/magic-link?email=kay@example.com');
    const unmounted = mountedDevInboxRoute({});
    expect((await unmounted.fetch(request())).status).toBe(404);
    const production = mountedDevInboxRoute({ ENVIRONMENT: 'dev', NODE_ENV: 'production' });
    expect((await production.fetch(request())).status).toBe(404);
    const mounted = mountedDevInboxRoute(devEnv);
    expect(mounted.routes.some((route) => route.path === '/dev/magic-link')).toBe(true);
    expect(unmounted.routes).toHaveLength(0);
  });
});
