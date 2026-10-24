import { ConfigProvider, Effect, Exit, Cause, Option } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { forgetDevMagicLinks, rememberDevMagicLink } from '@/api/lib/dev-magic-links';
import { latestDevMagicLinkRouteProgram } from './dev-inbox.handler';

const withEnvironment = (environment: string) =>
  Effect.withConfigProvider(ConfigProvider.fromMap(new Map([['ENVIRONMENT', environment]])));

const failureTag = (exit: Exit.Exit<unknown, { _tag: string }>) => {
  if (!Exit.isFailure(exit)) throw new Error('expected failure');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('expected typed failure');
  return failure.value._tag;
};

describe('dev mock inbox (UAT #32, B10)', () => {
  afterEach(() => {
    forgetDevMagicLinks();
    delete process.env.ENVIRONMENT;
  });

  it('returns the latest real link sent to the address', async () => {
    rememberDevMagicLink('Kay@Example.com', 'http://localhost:5173/auth/verify?token=first');
    rememberDevMagicLink('kay@example.com', 'http://localhost:5173/auth/verify?token=second');
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
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=a');
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
    process.env.ENVIRONMENT = 'staging';
    rememberDevMagicLink('kay@example.com', 'http://x/auth/verify?token=a');
    delete process.env.ENVIRONMENT;
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
});
