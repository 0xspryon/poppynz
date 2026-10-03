/**
 * Stripe signs platform events and Connect events with different endpoint
 * secrets once they are registered as two dashboard endpoints (both pointing
 * at /webhooks/stripe). An event is accepted when it verifies against ANY
 * configured secret — never when none is configured. Async because stripe@23
 * verifies with `constructEventAsync` (SubtleCrypto under Bun).
 */
export const constructEventWithAnySecret = async <T>(
  construct: (secret: string) => Promise<T>,
  secrets: ReadonlyArray<string>
): Promise<T> => {
  let lastError: unknown = new Error('no Stripe webhook secret configured');
  for (const secret of secrets) {
    try {
      return await construct(secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};
