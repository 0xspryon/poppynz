import { describe, expect, it } from 'bun:test';
import cleared from './fixtures/webhook-complete-cleared.json';
import {
  credibledOutcomeFromStatus,
  credibledOutcomeFromWebhook,
  resolveCredibledCheckValue
} from './outcome';

// The fixture is a real successful delivery's shape (applicant details
// replaced). Everything not cleared is derived from it, since no failed
// delivery has been captured yet.
const withCheckScore = (score: string | null) => ({
  ...cleared,
  scan_list: [{ ...cleared.scan_list[0], score }]
});

describe('credibled outcome from a webhook', () => {
  it('reads a real successful delivery as cleared', () => {
    expect(credibledOutcomeFromWebhook(cleared)).toEqual({
      outcome: 'cleared',
      score: 'Cleared',
      checks: [
        {
          value: 'request_credential_verification',
          name: 'Credential Verification',
          status: 'Complete',
          score: 'Cleared',
          outcome: 'cleared'
        }
      ]
    });
  });

  it('flags any score that is not Cleared, even an unfamiliar one', () => {
    const result = credibledOutcomeFromWebhook({ ...cleared, score: 'Not Cleared' });
    expect(result.outcome).toBe('not_cleared');
    expect(result.score).toBe('Not Cleared');

    expect(credibledOutcomeFromWebhook({ ...cleared, score: 'Consider' }).outcome).toBe(
      'not_cleared'
    );
  });

  it('flags an adverse check behind a cleared overall score', () => {
    const result = credibledOutcomeFromWebhook(withCheckScore('Review'));
    expect(result.outcome).toBe('not_cleared');
    expect(result.checks[0]?.outcome).toBe('not_cleared');
  });

  it('does not clear a check whose execution did not complete', () => {
    const result = credibledOutcomeFromWebhook({
      ...cleared,
      check_executions: [{ ...cleared.check_executions[0], status: 'FAILED' }]
    });
    expect(result.outcome).toBe('inconclusive');
  });

  it('treats a missing or "None" score as unscored, not adverse', () => {
    expect(credibledOutcomeFromWebhook({ ...cleared, score: 'None' })).toMatchObject({
      outcome: 'inconclusive',
      score: null
    });
    expect(credibledOutcomeFromWebhook({ ...cleared, score: null }).outcome).toBe('inconclusive');
    expect(credibledOutcomeFromWebhook(withCheckScore(null)).checks[0]?.outcome).toBe(
      'inconclusive'
    );
  });

  it('never clears a check Credibled has not called Complete', () => {
    const result = credibledOutcomeFromWebhook({
      ...cleared,
      application_status: 'Action Required'
    });
    expect(result.outcome).toBe('inconclusive');
  });

  it('survives a body with none of the result fields', () => {
    expect(credibledOutcomeFromWebhook({ application_status: 'Complete' })).toEqual({
      outcome: 'inconclusive',
      score: null,
      checks: []
    });
    expect(credibledOutcomeFromWebhook({ scan_list: 'nope', check_executions: [null] })).toEqual({
      outcome: 'inconclusive',
      score: null,
      checks: []
    });
  });
});

describe('credibled outcome from a status read', () => {
  const status = (checks: Array<{ name: string; score: string | null }>, applicationStatus = 'Complete') => ({
    uuid: 'check-1',
    applicationStatus,
    checkStatuses: checks.map((check) => ({
      checkTypeName: check.name,
      status: 'Complete',
      score: check.score
    }))
  });

  it('clears when every check is Cleared', () => {
    expect(
      credibledOutcomeFromStatus(status([{ name: 'credential_verification', score: 'Cleared' }]))
    ).toMatchObject({ outcome: 'cleared', score: 'Cleared' });
  });

  it('flags when any check is not', () => {
    const result = credibledOutcomeFromStatus(
      status([
        { name: 'credential_verification', score: 'Cleared' },
        { name: 'Canadian Driver Abstracts', score: 'Not Cleared' }
      ])
    );
    expect(result.outcome).toBe('not_cleared');
    expect(result.score).toBeNull();
    expect(result.checks.map((check) => check.value)).toEqual([
      'request_credential_verification',
      'request_motor_vehicle_records'
    ]);
  });

  it('is inconclusive when a check is unscored or there are none', () => {
    expect(
      credibledOutcomeFromStatus(status([{ name: 'credential_verification', score: null }])).outcome
    ).toBe('inconclusive');
    expect(credibledOutcomeFromStatus(status([])).outcome).toBe('inconclusive');
  });
});

describe('resolving a check name', () => {
  it('accepts a value, a bare name or a label', () => {
    expect(resolveCredibledCheckValue('request_soquij')).toBe('request_soquij');
    expect(resolveCredibledCheckValue('credential_verification')).toBe(
      'request_credential_verification'
    );
    expect(resolveCredibledCheckValue('Canadian Credit Check')).toBe('request_equifax');
    expect(resolveCredibledCheckValue('Something new')).toBeNull();
    expect(resolveCredibledCheckValue(null)).toBeNull();
  });
});
