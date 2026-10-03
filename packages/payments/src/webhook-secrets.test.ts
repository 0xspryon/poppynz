import { describe, expect, it } from 'bun:test';
import { constructEventWithAnySecret } from './webhook-secrets';

const constructWith = (validSecret: string) => async (secret: string) => {
  if (secret !== validSecret) throw new Error(`bad signature for ${secret}`);
  return { id: 'evt_1' };
};

describe('constructEventWithAnySecret', () => {
  it('accepts an event signed with the platform secret', async () => {
    expect(
      await constructEventWithAnySecret(constructWith('whsec_platform'), [
        'whsec_platform',
        'whsec_connect'
      ])
    ).toEqual({ id: 'evt_1' });
  });

  it('accepts an event signed with the Connect secret', async () => {
    expect(
      await constructEventWithAnySecret(constructWith('whsec_connect'), [
        'whsec_platform',
        'whsec_connect'
      ])
    ).toEqual({ id: 'evt_1' });
  });

  it('rejects an event matching neither, with the last verification error', async () => {
    await expect(
      constructEventWithAnySecret(constructWith('whsec_other'), ['whsec_platform', 'whsec_connect'])
    ).rejects.toThrow('bad signature for whsec_connect');
  });

  it('rejects everything when no secret is configured', async () => {
    await expect(constructEventWithAnySecret(constructWith('x'), [])).rejects.toThrow(
      'no Stripe webhook secret configured'
    );
  });
});
