import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	forgetReplacement,
	readReplacementParams,
	recallReplacement,
	rememberReplacement,
	writeReplacementParams
} from './replacement';

const CONTRACT = '0198a3b0-0000-7000-8000-00000000c001';
const S1 = '0198a3b0-0000-7000-8000-00000000ee01';
const S2 = '0198a3b0-0000-7000-8000-00000000ee02';

describe('replacement params (Find a replacement, Tier 3 step 1b)', () => {
	it('reads the contract and sessions from the URL, and writes them back', () => {
		const params = new URLSearchParams(
			`service=Childcare&replace=${CONTRACT}&sessions=${S1},${S2}`
		);
		const read = readReplacementParams(params);
		expect(read).toEqual({ contractId: CONTRACT, sessionIds: [S1, S2] });
		const out = new URLSearchParams();
		writeReplacementParams(out, read);
		expect(out.toString()).toBe(
			new URLSearchParams({ replace: CONTRACT, sessions: `${S1},${S2}` }).toString()
		);
	});

	it('ignores anything that is not a contract and session ids', () => {
		expect(readReplacementParams(new URLSearchParams('replace=x&sessions=y'))).toBeNull();
		expect(readReplacementParams(new URLSearchParams(`replace=${CONTRACT}`))).toBeNull();
		expect(
			readReplacementParams(new URLSearchParams(`replace=${CONTRACT}&sessions=${S1},nope`))
		).toBeNull();
	});
});

describe('remembered across a reach-out', () => {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key)
	});

	afterEach(() => {
		store.clear();
		vi.useRealTimers();
	});

	it('remembers the context per helper until it is forgotten', () => {
		rememberReplacement('helper-2', { contractId: CONTRACT, sessionIds: [S1] });
		expect(recallReplacement('helper-2')).toEqual({ contractId: CONTRACT, sessionIds: [S1] });
		expect(recallReplacement('helper-3')).toBeNull();
		forgetReplacement('helper-2');
		expect(recallReplacement('helper-2')).toBeNull();
	});

	it('drops a context remembered more than 30 days ago', () => {
		vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z') });
		rememberReplacement('helper-2', { contractId: CONTRACT, sessionIds: [S1] });
		vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
		expect(recallReplacement('helper-2')).toBeNull();
	});

	it('survives storage that throws (private mode)', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
			removeItem: () => {
				throw new Error('denied');
			}
		});
		expect(() =>
			rememberReplacement('helper-2', { contractId: CONTRACT, sessionIds: [S1] })
		).not.toThrow();
		expect(recallReplacement('helper-2')).toBeNull();
	});
});
