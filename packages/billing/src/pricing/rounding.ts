/**
 * The ONE rounding rule for money (umbrella §6: "one rounding rule shared by
 * holds, captures and displays"). Integer cents in, integer cents out:
 * `numerator / denominator` rounded half up. Session values, fees,
 * commissions and tax lines all go through here, on the server and in the
 * browser, so a displayed figure can never differ from a charged one.
 */
export const roundHalfUp = (numerator: number, denominator: number): number => {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError(`roundHalfUp needs integers, got ${numerator}/${denominator}`);
  }
  if (numerator < 0 || denominator <= 0) {
    throw new RangeError(`roundHalfUp needs a non-negative numerator and a positive denominator`);
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
};

/** `amountCents × basisPoints / 10000`, rounded half up. */
export const applyBps = (amountCents: number, basisPoints: number): number =>
  roundHalfUp(amountCents * basisPoints, 10_000);

/** One session's value: `rate × minutes / 60`, rounded half up. */
export const sessionValueCents = (rateCents: number, minutes: number): number =>
  roundHalfUp(rateCents * minutes, 60);
