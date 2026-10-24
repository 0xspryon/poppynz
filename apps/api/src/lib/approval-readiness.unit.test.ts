import { describe, expect, it } from 'vitest';
import { approvalBlockers, describeBlocker, submissionBlockers } from './approval-readiness';

const entry = (
  name: string,
  status: 'missing' | 'submitted' | 'approved' | 'rejected',
  isOptional = false
) => ({ documentTypeId: `${name}-id`, name, isOptional, status });

describe('approvalBlockers', () => {
  it('is empty when every required document is approved and the helper has a photo', () => {
    expect(
      approvalBlockers({
        role: 'service-provider',
        profile: { image: 'users/p/photo.jpg' },
        checklist: [entry('ID', 'approved'), entry('VSC', 'missing', true)]
      })
    ).toEqual([]);
  });

  it('blocks on a missing, rejected or unreviewed required document', () => {
    const blockers = approvalBlockers({
      role: 'family',
      profile: { image: null },
      checklist: [entry('ID', 'missing'), entry('CRC', 'rejected'), entry('Other', 'submitted')]
    });
    expect(blockers.map((blocker) => blocker.kind)).toEqual([
      'document_missing',
      'document_rejected',
      'document_unreviewed'
    ]);
  });

  it('requires the profile photo for helpers only', () => {
    expect(
      approvalBlockers({ role: 'service-provider', profile: { image: null }, checklist: [] })
    ).toEqual([{ kind: 'photo_missing' }]);
    expect(approvalBlockers({ role: 'family', profile: { image: null }, checklist: [] })).toEqual(
      []
    );
  });

  it('ignores optional documents in any state', () => {
    expect(
      approvalBlockers({
        role: 'family',
        profile: { image: null },
        checklist: [entry('VSC', 'rejected', true), entry('First aid', 'submitted', true)]
      })
    ).toEqual([]);
  });
});

describe('submissionBlockers', () => {
  it('lets a request through while documents only await the admin review', () => {
    expect(
      submissionBlockers({
        role: 'service-provider',
        profile: { image: 'x' },
        checklist: [entry('ID', 'submitted')]
      })
    ).toEqual([]);
  });

  it('blocks on what only the applicant can fix', () => {
    expect(
      submissionBlockers({
        role: 'service-provider',
        profile: { image: null },
        checklist: [entry('ID', 'missing')]
      }).map((blocker) => blocker.kind)
    ).toEqual(['photo_missing', 'document_missing']);
  });
});

describe('describeBlocker', () => {
  it('names the document', () => {
    expect(
      describeBlocker({ kind: 'document_unreviewed', documentTypeId: 'x', name: 'Government ID' })
    ).toContain('Government ID');
  });
});
