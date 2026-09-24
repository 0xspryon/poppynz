# Contract Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contract dates, session times and "today" run in the family's own time zone (frozen per contract version) instead of `Pacific/Auckland`, with start-date rules at send/accept and an optional last-day end time.

**Architecture:** A new leaf package `@repo/calendar` owns every time-zone computation (Temporal polyfill + offline tz lookup). `contract_versions` gains `time_zone` (set at send, frozen at acceptance) and `ends_at_minutes`. The contracts API routes every date rule through the version's zone; the web app shows the zone label, an end-time field, and the new errors as toasts.

**Tech Stack:** Bun workspaces + Turborepo, Effect 3, Hono RPC, Drizzle (hand-written SQL migrations), SvelteKit 5 (runes) + DaisyUI 5, vitest (api, web), `bun test` (packages), `temporal-polyfill@^1.0.5`, `@photostructure/tz-lookup@^11.7.0`.

**Spec:** `docs/superpowers/specs/2026-09-24-contract-dates-design.md` (umbrella: `docs/superpowers/specs/2026-09-24-stripe-contract-billing-design.md`).

## Global Constraints

- Work in the worktree `/run/media/hbt/work/poppynz/contract-dates` (branch `feature/contract-dates`). Never `cd` into another worktree.
- Only `@repo/calendar` names time zones or does zone math. No `Pacific/Auckland`, no "NZ" left in contract code or copy.
- Contract dates are zone-less `YYYY-MM-DD` strings; moments are UTC `Date`s; the zone is a parameter.
- Web code imports only `@repo/calendar` (browser-safe root). `@repo/calendar/lookup` is server-only.
- Migrations are hand-authored SQL plus a hand-added `meta/_journal.json` entry. Never run `drizzle-kit generate`.
- AGENTS.md rules: route error types derived from programs; mapper cases by `_tag` ending in `handleNever`; new route/domain behaviour gets focused unit tests; pipe repo calls through mappers (`repo.x().pipe((errors) => mapContractRepoError(errors))`); user-facing success/error messages are toasts.
- Commit after every task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Error codes (exact): `START_DATE_REQUIRED` (422), `FAMILY_LOCATION_REQUIRED` (422), `START_DATE_NOT_IN_FUTURE` (422), `CONTRACT_START_DATE_PASSED` (409).
- Tie rule: when the negotiated end date equals the notice end date, the negotiated one wins (its end time applies).

## File Structure

| File | Responsibility |
|---|---|
| `packages/calendar/package.json` | New package manifest (exports `.` and `./lookup`) |
| `packages/calendar/src/index.ts` | Browser-safe date/zone functions |
| `packages/calendar/src/lookup.ts` | Server-only `zoneForLocation` |
| `packages/calendar/src/index.test.ts`, `lookup.test.ts` | Package tests |
| 5 × `Dockerfile*.production` | Copy the new package manifest into the deps layer |
| `packages/db/src/migrations/0023_contract_dates.sql` + `meta/_journal.json` | Columns + checks |
| `packages/db/src/schema.ts` | `timeZone`, `endsAtMinutes`, checks, comments |
| `packages/db/src/repos/contract-repo.ts` | Repo inputs + fixtures |
| `apps/api/src/routes/app/contracts/contracts.validator.ts` | `endsAtMinutes` validation |
| `apps/api/src/routes/app/contracts/contracts.handler.ts` | Date rules, send/accept checks, DTO, errors |
| `apps/api/src/routes/app/contracts/contracts.unit.test.ts` | API tests |
| `apps/web/src/lib/contract-sessions.ts` (+ new `.test.ts`) | `formatEndTime`, comments |
| `apps/web/src/lib/api/contracts.ts` | `endsAtMinutes` in terms input |
| `apps/web/src/lib/components/contracts/ContractTermsView.svelte` (+ mount test) | Zone label, end time |
| `apps/web/src/lib/components/contracts/ContractTermsEditor.svelte` (+ mount test) | Min date, end-time field, location prompt |
| `apps/web/src/lib/components/contracts/ServiceWizard.svelte` | Zone copy |
| `apps/web/src/lib/components/contracts/ContractDetailPage.svelte` | Wiring, blocked accept, toasts, notice date |

---

### Task 1: `@repo/calendar` package

**Files:**
- Create: `packages/calendar/package.json`, `packages/calendar/src/index.ts`, `packages/calendar/src/lookup.ts`, `packages/calendar/src/index.test.ts`, `packages/calendar/src/lookup.test.ts`
- Modify: `apps/api/Dockerfile.production`, `apps/worker/Dockerfile.production`, `apps/web/Dockerfile.production`, `Dockerfile.seeds.production`, `Dockerfile.migrations.production`; `apps/api/package.json`, `apps/web/package.json` (dependency)

**Interfaces:**
- Produces (root `@repo/calendar`):
  - `type IsoDate = string`
  - `MINUTES_PER_DAY = 1440`
  - `dateIn(at: Date, zone: string): IsoDate`
  - `todayIn(zone: string, now?: Date): IsoDate`
  - `addDays(date: IsoDate, days: number): IsoDate`
  - `instantAt(date: IsoDate, minutes: number, zone: string): Date`
  - `sessionElapsedMinutes(date: IsoDate, session: { startMinutes: number; endMinutes: number }, zone: string, endCapMinutes?: number | null): number`
  - `zoneLabel(zone: string, locale?: string, at?: Date): string`
- Produces (`@repo/calendar/lookup`): `zoneForLocation(latitude: number, longitude: number): string | null`

- [ ] **Step 1: Create the manifest**

`packages/calendar/package.json`:

```json
{
  "name": "@repo/calendar",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./lookup": "./src/lookup.ts"
  },
  "scripts": {
    "test": "bun test src"
  },
  "dependencies": {
    "@photostructure/tz-lookup": "^11.7.0",
    "temporal-polyfill": "^1.0.5"
  }
}
```

Add `"@repo/calendar": "*",` to `dependencies` in `apps/api/package.json` (alphabetically, before `"@repo/credibled"`) and in `apps/web/package.json` (same position, tab-indented like its neighbours). Then run from the worktree root:

```bash
bun install
```

Expected: completes, `node_modules/@repo/calendar` is a symlink.

- [ ] **Step 2: Write the failing tests**

`packages/calendar/src/index.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  addDays,
  dateIn,
  instantAt,
  sessionElapsedMinutes,
  todayIn,
  zoneLabel
} from './index';

const WPG = 'America/Winnipeg';

describe('dateIn / todayIn', () => {
  it('reads the calendar date in the zone, not in UTC', () => {
    // 04:30Z is still 23:30 the previous evening in Winnipeg (CDT, UTC-5).
    expect(dateIn(new Date('2026-09-24T04:30:00Z'), WPG)).toBe('2026-09-23');
    expect(todayIn(WPG, new Date('2026-09-24T05:30:00Z'))).toBe('2026-09-24');
  });

  it('handles the half-hour Newfoundland offset', () => {
    // NDT is UTC-2:30: 02:15Z is 23:45 the previous day.
    expect(dateIn(new Date('2026-07-02T02:15:00Z'), 'America/St_Johns')).toBe('2026-07-01');
  });
});

describe('addDays', () => {
  it('rolls over months and years', () => {
    expect(addDays('2026-10-24', 14)).toBe('2026-11-07');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('instantAt', () => {
  it('converts wall-clock minutes to the UTC instant', () => {
    expect(instantAt('2026-07-01', 540, WPG).toISOString()).toBe('2026-07-01T14:00:00.000Z');
  });

  it('reads 1440 as the next midnight', () => {
    expect(instantAt('2026-07-01', 1440, WPG).toISOString()).toBe('2026-07-02T05:00:00.000Z');
  });

  it('moves a time inside the spring-forward gap to the moment the clock resumes', () => {
    // 2026-03-08 02:00 CST jumps to 03:00 CDT (08:00Z); 02:30 does not exist.
    expect(instantAt('2026-03-08', 150, WPG).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('takes the first occurrence of a time repeated by the fall-back', () => {
    // 2026-11-01 01:30 happens at 06:30Z (CDT) and again at 07:30Z (CST).
    expect(instantAt('2026-11-01', 90, WPG).toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('rejects minutes outside 0..1440', () => {
    expect(() => instantAt('2026-07-01', 1441, WPG)).toThrow(RangeError);
  });
});

describe('sessionElapsedMinutes', () => {
  const overnight = { startMinutes: 60, endMinutes: 300 }; // 01:00–05:00

  it('bills the scheduled length on an ordinary day', () => {
    expect(sessionElapsedMinutes('2026-07-01', overnight, WPG)).toBe(240);
  });

  it('bills 3 real hours on the spring-forward night', () => {
    expect(sessionElapsedMinutes('2026-03-08', overnight, WPG)).toBe(180);
  });

  it('bills 5 real hours on the fall-back night', () => {
    expect(sessionElapsedMinutes('2026-11-01', overnight, WPG)).toBe(300);
  });

  it('follows Toronto transitions at Toronto 2:00, not Winnipeg 2:00', () => {
    expect(sessionElapsedMinutes('2026-03-08', overnight, 'America/Toronto')).toBe(180);
  });

  it('never changes length in Regina (no DST)', () => {
    expect(sessionElapsedMinutes('2026-03-08', overnight, 'America/Regina')).toBe(240);
    expect(sessionElapsedMinutes('2026-11-01', overnight, 'America/Regina')).toBe(240);
  });

  it('counts a gap start from the moment the clock resumes', () => {
    // 02:30–05:00 on spring-forward night: 03:00 CDT → 05:00 CDT.
    expect(
      sessionElapsedMinutes('2026-03-08', { startMinutes: 150, endMinutes: 300 }, WPG)
    ).toBe(120);
  });

  it('cuts a session at the last-day end time', () => {
    const day = { startMinutes: 540, endMinutes: 1020 }; // 09:00–17:00
    expect(sessionElapsedMinutes('2026-07-01', day, WPG, 720)).toBe(180);
  });

  it('drops a session that starts at or after the end time', () => {
    const afternoon = { startMinutes: 780, endMinutes: 1020 }; // 13:00–17:00
    expect(sessionElapsedMinutes('2026-07-01', afternoon, WPG, 720)).toBe(0);
    expect(sessionElapsedMinutes('2026-07-01', { startMinutes: 720, endMinutes: 780 }, WPG, 720)).toBe(0);
  });

  it('ignores a cap later than the session', () => {
    expect(sessionElapsedMinutes('2026-07-01', { startMinutes: 540, endMinutes: 660 }, WPG, 720)).toBe(120);
  });
});

describe('zoneLabel', () => {
  it('uses the generic name that does not flip with DST', () => {
    const summer = new Date('2026-07-01T12:00:00Z');
    const winter = new Date('2026-01-15T12:00:00Z');
    expect(zoneLabel(WPG, 'en-CA', summer)).toBe('Central Time');
    expect(zoneLabel(WPG, 'en-CA', winter)).toBe('Central Time');
    expect(zoneLabel('America/Toronto', 'en-CA', summer)).toBe('Eastern Time');
    expect(zoneLabel('America/Vancouver', 'en-CA', summer)).toBe('Pacific Time');
  });
});
```

`packages/calendar/src/lookup.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { zoneForLocation } from './lookup';

describe('zoneForLocation', () => {
  it.each([
    ['Winnipeg', 49.8951, -97.1384, 'America/Winnipeg'],
    ['Regina (no DST)', 50.4452, -104.6189, 'America/Regina'],
    ['Kenora (Central, in Ontario)', 49.767, -94.4894, 'America/Winnipeg'],
    ['Cranbrook (Mountain, in BC)', 49.512, -115.7694, 'America/Edmonton'],
    ['Toronto', 43.6532, -79.3832, 'America/Toronto'],
    ['Vancouver', 49.2827, -123.1207, 'America/Vancouver'],
    ["St. John's", 47.5615, -52.7126, 'America/St_Johns']
  ])('%s', (_name, latitude, longitude, zone) => {
    expect(zoneForLocation(latitude, longitude)).toBe(zone);
  });

  it('returns null for impossible coordinates instead of throwing', () => {
    expect(zoneForLocation(200, 0)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/calendar && bun test src`
Expected: FAIL — `Cannot find module './index'` / `'./lookup'`.

- [ ] **Step 4: Implement the package**

`packages/calendar/src/index.ts`:

```ts
import { Temporal } from 'temporal-polyfill';

/**
 * Calendar and time-zone arithmetic — the only place in the monorepo that
 * knows about time zones. Everything here is browser-safe; the location →
 * zone lookup lives in `./lookup` because its boundary data is server-only.
 *
 * Conventions: a calendar date is a zone-less `YYYY-MM-DD` string, a moment is
 * a UTC `Date`, and the zone is always an explicit IANA-name parameter.
 */

/** A calendar date, `YYYY-MM-DD`, with no time zone attached. */
export type IsoDate = string;

export const MINUTES_PER_DAY = 24 * 60;

/** The calendar date an instant falls on in `zone`. */
export const dateIn = (at: Date, zone: string): IsoDate =>
  Temporal.Instant.fromEpochMilliseconds(at.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();

/** Today's calendar date in `zone`. */
export const todayIn = (zone: string, now: Date = new Date()): IsoDate => dateIn(now, zone);

/** Pure calendar arithmetic — no zone, no DST. */
export const addDays = (date: IsoDate, days: number): IsoDate =>
  Temporal.PlainDate.from(date).add({ days }).toString();

/**
 * Wall-clock minutes (0–1440, 1440 = the next midnight) on `date` in `zone` →
 * the UTC instant.
 *
 * A time repeated by the fall-back takes its first occurrence (Temporal's
 * default). A time inside the spring-forward gap does not exist: Temporal
 * would push it past the gap by the gap's length (02:30 → 03:30); our rule is
 * the moment the clock resumes (03:00), so nobody's session loses time.
 */
export const instantAt = (date: IsoDate, minutes: number, zone: string): Date => {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`minutes must be an integer in 0..${MINUTES_PER_DAY}, got ${minutes}`);
  }
  const day =
    minutes === MINUTES_PER_DAY
      ? Temporal.PlainDate.from(date).add({ days: 1 })
      : Temporal.PlainDate.from(date);
  const wall = minutes % MINUTES_PER_DAY;
  const time = Temporal.PlainTime.from({ hour: Math.floor(wall / 60), minute: wall % 60 });
  const zoned = day.toZonedDateTime({ timeZone: zone, plainTime: time });
  if (!zoned.toPlainTime().equals(time)) {
    const resumed = zoned.getTimeZoneTransition('previous');
    if (resumed) return new Date(resumed.epochMilliseconds);
  }
  return new Date(zoned.epochMilliseconds);
};

/**
 * Real elapsed minutes of one session on `date` in `zone` — 3 h or 5 h for a
 * 01:00–05:00 session on DST nights. `endCapMinutes` is the last-day end time:
 * a session crossing it is shortened, one starting at or after it counts 0.
 */
export const sessionElapsedMinutes = (
  date: IsoDate,
  session: { startMinutes: number; endMinutes: number },
  zone: string,
  endCapMinutes: number | null = null
): number => {
  const end =
    endCapMinutes === null ? session.endMinutes : Math.min(session.endMinutes, endCapMinutes);
  if (end <= session.startMinutes) return 0;
  const startAt = instantAt(date, session.startMinutes, zone).getTime();
  const endAt = instantAt(date, end, zone).getTime();
  return Math.round((endAt - startAt) / 60_000);
};

/** "Central Time" — the generic name, which doesn't flip twice a year the way
 * "Central Daylight Time" does. Falls back to the IANA name. */
export const zoneLabel = (zone: string, locale = 'en-CA', at: Date = new Date()): string =>
  new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value ?? zone;
```

`packages/calendar/src/lookup.ts`:

```ts
import tzlookup from '@photostructure/tz-lookup';

/**
 * Server-only: the IANA zone for a point, from boundary data bundled with the
 * library (no network). Province alone is not enough — Ontario, BC, Quebec and
 * Labrador each span two zones and Saskatchewan has no DST. Null for
 * coordinates the library rejects.
 */
export const zoneForLocation = (latitude: number, longitude: number): string | null => {
  try {
    return tzlookup(latitude, longitude);
  } catch {
    return null;
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/calendar && bun test src`
Expected: PASS (all tests in both files).

- [ ] **Step 6: Add the package to the production Docker deps layers**

In each of `apps/api/Dockerfile.production`, `apps/worker/Dockerfile.production`, `apps/web/Dockerfile.production`, `Dockerfile.seeds.production`, `Dockerfile.migrations.production`, insert immediately above the line `COPY packages/credibled/package.json packages/credibled/`:

```dockerfile
COPY packages/calendar/package.json packages/calendar/
```

Verify: `grep -c "packages/calendar/package.json" apps/api/Dockerfile.production apps/worker/Dockerfile.production apps/web/Dockerfile.production Dockerfile.seeds.production Dockerfile.migrations.production` → each prints `1`.

- [ ] **Step 7: Commit**

```bash
git add packages/calendar apps/api/package.json apps/web/package.json bun.lock apps/api/Dockerfile.production apps/worker/Dockerfile.production apps/web/Dockerfile.production Dockerfile.seeds.production Dockerfile.migrations.production
git commit -m "feat(calendar): time-zone and calendar package for contract dates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema, migration and repo

**Files:**
- Create: `packages/db/src/migrations/0023_contract_dates.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`, `packages/db/src/schema.ts` (import line ~2, `ContractSession` comment ~813, `contractVersion` table ~896–932), `packages/db/src/repos/contract-repo.ts` (interface ~41–60, `createVersion`/`updateVersionTerms` impls ~245–270, fixtures ~422–450)

**Interfaces:**
- Produces: `ContractVersion` gains `timeZone: string | null` and `endsAtMinutes: number | null`.
- `ContractRepo.createVersion` input gains `endsAtMinutes?: number | null`.
- `ContractRepo.updateVersionTerms` input becomes `{ services; startsOn; endsOn; endsAtMinutes: number | null; timeZone?: string | null }` — `timeZone` omitted means "leave as is".

- [ ] **Step 1: Write the migration**

`packages/db/src/migrations/0023_contract_dates.sql`:

```sql
-- Contract dates follow the family's own time zone, not Pacific/Auckland.
--
-- time_zone: IANA name taken from the family's location when the terms are
-- sent, frozen when the version is accepted (accepted versions are never
-- edited). Null only while a version is a draft.
-- ends_at_minutes: optional last-day end time for a negotiated end date,
-- wall-clock minutes 1..1440 in time_zone; sessions that day are cut at it.
ALTER TABLE "app_db"."contract_versions"
  ADD COLUMN "time_zone" text,
  ADD COLUMN "ends_at_minutes" integer;--> statement-breakpoint
-- Development data only (nothing exists in staging or production): give every
-- sent version a zone so the check below holds.
UPDATE "app_db"."contract_versions"
  SET "time_zone" = 'America/Winnipeg'
  WHERE "status" <> 'draft' AND "time_zone" IS NULL;--> statement-breakpoint
ALTER TABLE "app_db"."contract_versions"
  ADD CONSTRAINT "contract_versions_time_zone_when_sent"
    CHECK ("status" = 'draft' OR "time_zone" IS NOT NULL),
  ADD CONSTRAINT "contract_versions_ends_at_minutes_valid"
    CHECK ("ends_at_minutes" IS NULL
           OR ("ends_on" IS NOT NULL AND "ends_at_minutes" BETWEEN 1 AND 1440));
```

In `packages/db/src/migrations/meta/_journal.json`, append to `entries` (after the `0022_check_order_outcome` object, keeping the file on one line as it is):

```json
{"idx": 23, "version": "7", "when": 1788140000000, "tag": "0023_contract_dates", "breakpoints": true}
```

- [ ] **Step 2: Update the Drizzle schema**

In `packages/db/src/schema.ts`, add `check` to the existing `drizzle-orm/pg-core` import list.

Replace the `ContractSession` comment (the two lines starting `// One proposed weekly session. Times are wall-clock minutes from midnight in` … `// "3:30–6:00 pm" session stays 3:30–6:00 pm across DST changes.`) with:

```ts
// One proposed weekly session. Times are wall-clock minutes from midnight in
// the contract version's own time zone (`contract_versions.time_zone`) — never
// UTC instants, so a "3:30–6:00 pm" session stays 3:30–6:00 pm across DST.
```

In the `contractVersion` table, directly after the `endsOn: date('ends_on'),` line add:

```ts
    // Optional last-day end time for the negotiated end date: wall-clock
    // minutes (1..1440) in time_zone. Sessions on that day are cut at it.
    endsAtMinutes: integer('ends_at_minutes'),
    // IANA zone the version's dates and session times are read in — the
    // family's, taken from their location when the terms are sent and frozen
    // at acceptance. Null only while the version is a draft.
    timeZone: text('time_zone'),
```

In the table's extras array, after `index('contract_versions_contract_id_idx').on(table.contractId)` add (with a comma after the index line):

```ts
    check(
      'contract_versions_time_zone_when_sent',
      sql`${table.status} = 'draft' or ${table.timeZone} is not null`
    ),
    check(
      'contract_versions_ends_at_minutes_valid',
      sql`${table.endsAtMinutes} is null or (${table.endsOn} is not null and ${table.endsAtMinutes} between 1 and 1440)`
    )
```

- [ ] **Step 3: Update the repo**

In `packages/db/src/repos/contract-repo.ts`:

`createVersion` input type — after `endsOn: string | null;` add `endsAtMinutes?: number | null;`. In its implementation `.values({...})`, after `endsOn: input.endsOn,` add `endsAtMinutes: input.endsAtMinutes ?? null,`.

`updateVersionTerms` input type becomes:

```ts
      input: {
        services: Array<ContractServiceItem>;
        startsOn: string | null;
        endsOn: string | null;
        endsAtMinutes: number | null;
        /** Written at send; omitted on draft saves so it's left untouched. */
        timeZone?: string | null;
      }
```

and its implementation's `.set(...)` becomes:

```ts
          .set({
            services: input.services,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            endsAtMinutes: input.endsAtMinutes,
            ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {})
          })
```

In `dummyContractVersion`: change the comment `// Tue & Thu 3:30–6:00 pm (NZ wall-clock minutes).` to `// Tue & Thu 3:30–6:00 pm (wall-clock minutes in the version's zone).` and after `endsOn: null,` add:

```ts
  endsAtMinutes: null,
  timeZone: null,
```

- [ ] **Step 4: Type-check callers**

Run: `cd apps/api && bunx tsc -p tsconfig.build.json --noEmit`
Expected: errors only in `contracts.handler.ts` where `updateVersionTerms` is called without `endsAtMinutes` (save and send programs). Fix both call sites now so the build is green:
- in `saveTermsProgram`, the `terms` object becomes `{ services, startsOn: input.startsOn ?? null, endsOn: input.endsOn ?? null, endsAtMinutes: null }` (Task 3 replaces `null` with the validated value);
- in `sendContractProgram`, add `endsAtMinutes: pending.endsAtMinutes` to the `updateVersionTerms` input.

Re-run: expected no errors.

- [ ] **Step 5: Apply the migration to the local stack and check the constraints**

The compose project is per worktree; only one stack may run at a time. Check what is running first:

```bash
docker ps --format '{{.Names}}' | head
docker inspect api --format '{{range .Mounts}}{{.Source}} {{end}}' 2>/dev/null
```

If another worktree's stack is up, stop it from that worktree's directory (`docker compose -f <that-worktree>/docker-compose.yml down`) — ask the user first if unsure whose it is. Then from this worktree:

```bash
mkdir -p bun_node_modules
docker compose up -d postgres
docker compose up migrations
```

Expected: migrations container exits 0, log mentions `0023_contract_dates`. Verify:

```bash
docker exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d app_db.contract_versions"' | grep -E "time_zone|ends_at_minutes|contract_versions_time_zone_when_sent|ends_at_minutes_valid"
```

Expected: both columns and both constraints listed.

- [ ] **Step 6: Commit**

```bash
git add packages/db apps/api/src/routes/app/contracts/contracts.handler.ts
git commit -m "feat(db): time_zone and ends_at_minutes on contract versions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Validator and draft saves carry the last-day end time

**Files:**
- Modify: `apps/api/src/routes/app/contracts/contracts.validator.ts` (~43–90), `apps/api/src/routes/app/contracts/contracts.handler.ts` (`toTermsResponse` ~310, `saveTermsProgram` ~560)
- Test: `apps/api/src/routes/app/contracts/contracts.unit.test.ts` (`describe('PUT /contracts/:id/terms')`)

**Interfaces:**
- Consumes: `updateVersionTerms` input from Task 2.
- Produces: `ContractTermsInput.endsAtMinutes?: number | null`; terms responses gain `endsAtMinutes: number | null`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('PUT /contracts/:id/terms', ...)` in `contracts.unit.test.ts` (reuse the existing `termsBody` constant defined at the top of that describe):

```ts
  it('saves a last-day end time with the end date', async () => {
    const updates: Array<unknown> = [];
    const layer = makeLayer({
      contractById: baseContract(),
      versions: [draftVersion()],
      onUpdateTerms: (_versionId, input) => updates.push(input)
    });

    await Effect.runPromise(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, endsOn: '2026-12-11', endsAtMinutes: 720 }
        }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(updates[0]).toMatchObject({ endsOn: '2026-12-11', endsAtMinutes: 720 });
    expect(updates[0]).not.toHaveProperty('timeZone');
  });

  it('rejects an end time without an end date at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: { ...termsBody, endsAtMinutes: 720 } }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RequestValidationError' });
  });

  it('rejects an end time outside 1..1440 at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, endsOn: '2026-12-11', endsAtMinutes: 0 }
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RequestValidationError' });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts -t "end time"`
Expected: the save test FAILS (`endsAtMinutes` is `null`), the validation tests FAIL (no error raised).

- [ ] **Step 3: Implement**

In `contracts.validator.ts`, change the session comment `// One weekly session: NZ wall-clock minutes from midnight (never UTC), Monday` to `// One weekly session: wall-clock minutes from midnight in the contract's zone (never UTC), Monday`.

Replace the tail of `contractTermsSchema` — from the `startsOn:` property to the end of the `.pipe(...)` — so it reads:

```ts
  startsOn: Schema.optional(Schema.NullOr(isoCalendarDate)),
  endsOn: Schema.optional(Schema.NullOr(isoCalendarDate)),
  // Last-day end time for the negotiated end date, wall-clock minutes.
  endsAtMinutes: Schema.optional(
    Schema.NullOr(Schema.Int.pipe(Schema.between(1, MINUTES_PER_DAY)))
  )
}).pipe(
  Schema.filter(
    (terms) =>
      !terms.startsOn ||
      !terms.endsOn ||
      terms.endsOn >= terms.startsOn ||
      'the end date must not be before the start date'
  ),
  Schema.filter(
    (terms) =>
      terms.endsAtMinutes === undefined ||
      terms.endsAtMinutes === null ||
      Boolean(terms.endsOn) ||
      'a last-day end time needs an end date'
  )
);
```

In `contracts.handler.ts`:
- `toTermsResponse`: after `endsOn: version.endsOn,` add `endsAtMinutes: version.endsAtMinutes,`.
- `saveTermsProgram`: the `terms` object becomes

```ts
    const terms = {
      services,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      // An end time only means something on a negotiated end date.
      endsAtMinutes: input.endsOn ? (input.endsAtMinutes ?? null) : null
    };
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/app/contracts
git commit -m "feat(contracts): optional last-day end time on the terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Read-time dates in the contract's zone

**Files:**
- Modify: `apps/api/src/routes/app/contracts/contracts.handler.ts` (lines ~207–265 date helpers, `presentedContractStatus`, `endContractProgram` ~823–856)
- Test: `apps/api/src/routes/app/contracts/contracts.unit.test.ts` (fixtures ~150–170, `describe('POST /contracts/:id/end')`, `describe('GET /contracts/:id')`)

**Interfaces:**
- Consumes: `todayIn`, `dateIn`, `addDays` from `@repo/calendar`.
- Produces (module-internal, used by Tasks 5–6):
  - `contractToday(version: ContractVersion): string | null`
  - `noticeEndsOn(contract: Contract, accepted: ContractVersion | null): string | null`
  - exported `effectiveEnd(contract, accepted): { endsOn: string; source: 'negotiated' | 'notice'; endsAtMinutes: number | null } | null`
  - exported `effectiveEndsOn(contract, accepted): string | null` (unchanged signature)

- [ ] **Step 1: Update the fixtures and write the failing tests**

At the top of `contracts.unit.test.ts`:
- add `afterEach` and `vi` to the vitest import: `import { afterEach, describe, expect, it, vi } from 'vitest';`
- add `import { addDays, todayIn } from '@repo/calendar';`
- after the `EXPIRED_SENT_AT` constant add:

```ts
const WPG = 'America/Winnipeg';

/** Pins `new Date()` / `Date.now()` only — Effect's scheduler keeps real timers. */
const freezeNow = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};
afterEach(() => {
  vi.useRealTimers();
});
```

In `draftVersion`, after `declineReason: null,` add `startsOn: '2099-01-05',` (far future, so the send/accept rules never trip unrelated tests). In `proposedVersion`, set the zone every sent version has:

```ts
const proposedVersion = (overrides: Partial<ContractVersion> = {}): ContractVersion =>
  draftVersion({ status: 'proposed', sentAt: RECENT_SENT_AT, timeZone: WPG, ...overrides });
```

Replace the whole `it("gives 2 weeks' notice and notifies ...")` test in `describe('POST /contracts/:id/end')` with:

```ts
  it("gives 2 weeks' notice and notifies the counterpart with the last working day", async () => {
    const published: Array<Published> = [];
    const endInputs: Array<any> = [];
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      versions: [proposedVersion({ status: 'accepted', decidedAt: new Date() })],
      published,
      onSetEnding: (input) => endInputs.push(input)
    });

    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: { note: 'Thanks for everything!' } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    // The notice date's calendar day in the contract zone, plus 14 days.
    const expectedEndsOn = addDays(todayIn(WPG), 14);
    expect(result).toEqual({ id: CONTRACT_ID, status: 'ending', endsOn: expectedEndsOn });
    expect(endInputs[0]).toEqual({
      endedByUserId: 'family-1',
      endNote: 'Thanks for everything!'
    });
    expect(published).toEqual([
      {
        userId: 'provider-1',
        input: {
          type: 'contract.ended',
          payload: {
            contractId: CONTRACT_ID,
            counterpartName: 'Priya Tester',
            endsOn: expectedEndsOn
          }
        }
      }
    ]);
  });

  it('counts the notice in calendar days in the contract zone, across a DST change', async () => {
    // 04:00Z on Oct 25 is still Oct 24 (23:00 CDT) in Winnipeg; +14 days
    // crosses the Nov 1 fall-back and lands on Nov 7.
    freezeNow('2026-10-25T04:00:00Z');
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      versions: [proposedVersion({ status: 'accepted', decidedAt: new Date() })]
    });

    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toMatchObject({ endsOn: '2026-11-07' });
  });
```

Append inside `describe('GET /contracts/:id', ...)`:

```ts
  it("keeps a contract running on its end date in the contract's own zone", async () => {
    // 06:30Z on Sep 10 is 23:30 on Sep 9 in Vancouver: the Sep 9 end date is
    // still today there, although UTC has moved on.
    freezeNow('2026-09-10T06:30:00Z');
    const accepted = proposedVersion({
      status: 'accepted',
      decidedAt: new Date(),
      endsOn: '2026-09-09',
      timeZone: 'America/Vancouver'
    });
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'active' }), [accepted], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );
    expect(contract.status).toBe('active');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts -t "notice|own zone"`
Expected: FAIL — end date computed in `Pacific/Auckland` (e.g. `2026-11-08`), and the Vancouver contract presents as `ended`.

- [ ] **Step 3: Implement**

In `contracts.handler.ts` add the import:

```ts
import { addDays, dateIn, todayIn } from '@repo/calendar';
```

Replace everything from the comment `/** All contract dates (session times, starts/ends, "today") are NZ wall-clock` down to and including the end of `export const effectiveEndsOn = ...` (the `nzIsoDate`, `todayIsoDate`, `DAY_MS`, `noticeEndsOn` and `effectiveEndsOn` definitions) with:

```ts
/** Contract dates are calendar dates in the version's own zone (the
 * family's, frozen at acceptance). Null only for a draft, which has no zone. */
const contractToday = (version: ContractVersion): string | null =>
  version.timeZone ? todayIn(version.timeZone) : null;

/** Last working day of the notice flow: the notice moment's calendar date in
 * the contract zone plus 14 calendar days — derived, never stored. */
const noticeEndsOn = (contract: Contract, accepted: ContractVersion | null) =>
  contract.endNoticedAt !== null && accepted?.timeZone
    ? addDays(dateIn(contract.endNoticedAt, accepted.timeZone), END_NOTICE_DAYS)
    : null;

/** The date the contract actually stops working — the earlier of the notice
 * flow's last working day and the negotiated end-date term — and which one it
 * was. Only a negotiated end carries a last-day end time; on a tie the
 * negotiated end wins so its end time still applies. */
export const effectiveEnd = (contract: Contract, accepted: ContractVersion | null) => {
  const notice = noticeEndsOn(contract, accepted);
  const negotiated = accepted?.endsOn ?? null;
  if (negotiated !== null && (notice === null || negotiated <= notice)) {
    return {
      endsOn: negotiated,
      source: 'negotiated' as const,
      endsAtMinutes: accepted?.endsAtMinutes ?? null
    };
  }
  if (notice !== null) {
    return { endsOn: notice, source: 'notice' as const, endsAtMinutes: null };
  }
  return null;
};

export const effectiveEndsOn = (contract: Contract, accepted: ContractVersion | null) =>
  effectiveEnd(contract, accepted)?.endsOn ?? null;
```

In `presentedContractStatus`, replace the ended check with:

```ts
  const endsOn = effectiveEndsOn(contract, accepted);
  const today = accepted !== null ? contractToday(accepted) : null;
  if (
    (contract.status === 'ending' || contract.status === 'active') &&
    endsOn !== null &&
    today !== null &&
    endsOn < today
  ) {
    return 'ended';
  }
```

Replace the body of `endContractProgram` from `const note = ...` through `const endsOn = noticeEndsOn(updated) ?? todayIsoDate();` with:

```ts
    // The notice end date is read in the in-force terms' zone; an active
    // contract without accepted terms is not a state ending can apply to.
    const { versions } = yield* loadPendingVersion(contractId);
    const accepted = acceptedOf(versions);
    if (!accepted?.timeZone) {
      return yield* Effect.fail(new ContractStateError());
    }

    const note = input.note?.trim() ? input.note.trim() : null;
    const updated = yield* contractRepo
      .setEnding(contractId, { endedByUserId: viewer.id, endNote: note })
      .pipe((errors) => mapContractRepoError(errors));
    if (!updated) {
      return yield* Effect.fail(new ContractStateError());
    }
    // Derived, not stored — the same computation every read applies.
    const endsOn = noticeEndsOn(updated, accepted) ?? todayIn(accepted.timeZone);
```

Also update the existing test `it('fails when the contract is not active', ...)` in the same describe: it passes no `versions`, so it now fails before `setEnding` — the expected `_tag` stays `ContractStateError`, no change needed. Confirm by running.

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts`
Expected: PASS (whole file). `grep -n "Auckland\|nzIsoDate\|todayIsoDate\|DAY_MS" apps/api/src/routes/app/contracts/contracts.handler.ts` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/app/contracts
git commit -m "fix(contracts): read contract dates in the contract's own time zone

Replaces the Pacific/Auckland literal. The notice end date is now the
notice day plus 14 calendar days in the contract zone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Send requires a start date after today in the family's zone

**Files:**
- Modify: `apps/api/src/routes/app/contracts/contracts.handler.ts` (error classes ~95, helper after `loadProfileOrNull`, `sendContractProgram` ~584–654, `contractRouteErrorToResponse`)
- Test: `apps/api/src/routes/app/contracts/contracts.unit.test.ts` (`profile` builder, `makeLayer`, `describe('POST /contracts/:id/send')`)

**Interfaces:**
- Consumes: `zoneForLocation` (`@repo/calendar/lookup`), `todayIn`, `loadProfileOrNull`, `updateVersionTerms({..., timeZone})`.
- Produces: `familyTimeZone(familyUserId: string): Effect<string | null, ContractRepoError, UserProfileRepo>` (used by Task 6); tagged errors `StartDateRequiredError`, `FamilyLocationRequiredError`, `StartDateNotInFutureError`.

- [ ] **Step 1: Give the test family a location and write the failing tests**

In `contracts.unit.test.ts`, change the `profile` builder signature and body so coordinates can be set:

```ts
const profile = (
  userId: string,
  firstName: string,
  phoneNumber: string | null,
  location: { latitude: number; longitude: number } | null = null
): SafeUserProfile => ({
```

and replace its `latitude: null, longitude: null` lines with:

```ts
  latitude: location?.latitude ?? null,
  longitude: location?.longitude ?? null
```

In `makeLayer`'s options type add:

```ts
    /** The family's saved coordinates; null = no address yet. Defaults to Winnipeg. */
    familyLocation?: { latitude: number; longitude: number } | null;
```

and in its `makeUserProfileRepoTest.findByUserId`, replace `profile('family-1', 'Priya', null)` with:

```ts
            profile(
              'family-1',
              'Priya',
              null,
              options.familyLocation === undefined
                ? { latitude: 49.8951, longitude: -97.1384 }
                : options.familyLocation
            )
```

Append inside `describe('POST /contracts/:id/send', ...)`:

```ts
  it("stamps the family's time zone on the version it sends", async () => {
    const updates: Array<unknown> = [];
    const layer = makeLayer({
      contractById: baseContract(),
      versions: [draftVersion()],
      onUpdateTerms: (_versionId, input) => updates.push(input)
    });

    await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(updates[0]).toMatchObject({ timeZone: WPG, startsOn: '2099-01-05' });
  });

  it('refuses to send without a start date', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({ contractById: baseContract(), versions: [draftVersion({ startsOn: null })] })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'StartDateRequiredError' });
  });

  it('refuses to send while the family has no saved location', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            familyLocation: null
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'FamilyLocationRequiredError' });
  });

  it("refuses a start date that is today in the family's zone", async () => {
    freezeNow('2026-09-10T05:30:00Z'); // Sep 10, 00:30 in Winnipeg
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-10' })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'StartDateNotInFutureError' });
  });

  it("allows tomorrow in the family's zone even when UTC is already there", async () => {
    freezeNow('2026-09-10T04:30:00Z'); // still Sep 9, 23:30 in Winnipeg
    const result = await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-10' })]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'proposed' });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts -t "send"`
Expected: FAIL — no `timeZone` written, the three refusals succeed instead of failing.

- [ ] **Step 3: Implement**

In `contracts.handler.ts` add the import:

```ts
import { zoneForLocation } from '@repo/calendar/lookup';
```

After `ContractProposalExpiredError` add:

```ts
/** Sending needs a start date — billing cycles are anchored to it. */
export class StartDateRequiredError extends Data.TaggedError('StartDateRequiredError')<{}> {}

/** The contract's zone comes from the family's location; without an address
 * there is no zone to read dates and session times in. */
export class FamilyLocationRequiredError extends Data.TaggedError(
  'FamilyLocationRequiredError'
)<{}> {}

/** The start date must be later than today in the family's zone. */
export class StartDateNotInFutureError extends Data.TaggedError('StartDateNotInFutureError')<{}> {}
```

After `loadProfileOrNull` add:

```ts
/** The family's zone from their saved coordinates, or null without them. */
const familyTimeZone = (familyUserId: string) =>
  loadProfileOrNull(familyUserId).pipe(
    Effect.map((profile) =>
      profile?.latitude != null && profile.longitude != null
        ? zoneForLocation(profile.latitude, profile.longitude)
        : null
    )
  );
```

In `sendContractProgram`, replace the block from `yield* contractRepo.updateVersionTerms(pending.id, {` through its closing `.pipe((errors) => mapContractRepoError(errors));` with:

```ts
    if (pending.startsOn === null) {
      return yield* Effect.fail(new StartDateRequiredError());
    }
    // The zone is the family's, read now and frozen with the version at
    // acceptance — a later move never shifts a signed contract's dates.
    const timeZone = yield* familyTimeZone(contract.familyUserId);
    if (timeZone === null) {
      return yield* Effect.fail(new FamilyLocationRequiredError());
    }
    if (pending.startsOn <= todayIn(timeZone)) {
      return yield* Effect.fail(new StartDateNotInFutureError());
    }

    yield* contractRepo
      .updateVersionTerms(pending.id, {
        services: refreshed,
        startsOn: pending.startsOn,
        endsOn: pending.endsOn,
        endsAtMinutes: pending.endsAtMinutes,
        timeZone
      })
      .pipe((errors) => mapContractRepoError(errors));
```

In `contractRouteErrorToResponse`, before `case 'SafetyVerificationRequiredError':` add:

```ts
    case 'StartDateRequiredError':
      return c.json(
        {
          error: {
            code: 'START_DATE_REQUIRED' as const,
            message: 'Pick a start date before sending.'
          }
        },
        422
      );
    case 'FamilyLocationRequiredError':
      return c.json(
        {
          error: {
            code: 'FAMILY_LOCATION_REQUIRED' as const,
            message: 'Add your address to your profile before sending — session times follow your local time zone.'
          }
        },
        422
      );
    case 'StartDateNotInFutureError':
      return c.json(
        {
          error: {
            code: 'START_DATE_NOT_IN_FUTURE' as const,
            message: 'The start date must be after today.'
          }
        },
        422
      );
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts`
Expected: PASS (whole file). Also `cd apps/api && bunx tsc -p tsconfig.build.json --noEmit` → no errors (the mapper's `handleNever` proves the new tags are handled).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/app/contracts
git commit -m "feat(contracts): send requires a future start date and the family's location

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Accept refused on/after the start date; detail DTO fields

**Files:**
- Modify: `apps/api/src/routes/app/contracts/contracts.handler.ts` (error class, helper, `acceptContractProgram` ~690–729, `getContractProgram` ~896–1005, mapper)
- Test: `apps/api/src/routes/app/contracts/contracts.unit.test.ts` (`describe('POST /contracts/:id/accept')`, `describe('GET /contracts/:id')`)

**Interfaces:**
- Consumes: `contractToday`, `effectiveEnd`, `familyTimeZone`, `zoneLabel`, `addDays`, `todayIn`.
- Produces: `ContractStartDatePassedError`; detail `contract` gains `timeZone: string | null`, `timeZoneLabel: string | null`, `earliestStartsOn: string | null`, `endsAtMinutes: number | null`, `acceptBlockedReason: 'start_date_passed' | null` (Task 8 consumes these through the RPC types).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('POST /contracts/:id/accept', ...)`:

```ts
  it('refuses accepting on the start date in the contract zone', async () => {
    freezeNow('2026-09-10T05:30:00Z'); // Sep 10, 00:30 in Winnipeg
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [
              proposedVersion({ startsOn: '2026-09-10', sentAt: new Date('2026-09-08T12:00:00Z') })
            ]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStartDatePassedError' });
  });

  it('allows accepting the evening before, although UTC is already on the start date', async () => {
    freezeNow('2026-09-10T04:30:00Z'); // Sep 9, 23:30 in Winnipeg
    const result = await Effect.runPromise(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [
              proposedVersion({ startsOn: '2026-09-10', sentAt: new Date('2026-09-08T12:00:00Z') })
            ]
          })
        )
      )
    );
    expect(result).toEqual({ id: CONTRACT_ID, status: 'active' });
  });
```

Append inside `describe('GET /contracts/:id', ...)`:

```ts
  it("gives the family's draft its zone, label and earliest start date", async () => {
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'draft' }), [draftVersion()], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract).toMatchObject({
      timeZone: WPG,
      timeZoneLabel: 'Central Time',
      earliestStartsOn: addDays(todayIn(WPG), 1),
      acceptBlockedReason: null
    });
  });

  it('leaves the zone empty for a family without a saved location', async () => {
    const layer = makeLayer({
      familyLocation: null,
      contractWithContext: withContext(baseContract({ status: 'draft' }), [draftVersion()], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract).toMatchObject({ timeZone: null, timeZoneLabel: null, earliestStartsOn: null });
  });

  it('tells the provider why Accept is gone once the start date has arrived', async () => {
    freezeNow('2026-09-10T05:30:00Z');
    const pending = proposedVersion({
      startsOn: '2026-09-10',
      sentAt: new Date('2026-09-08T12:00:00Z')
    });
    const layer = makeLayer({
      viewer: providerUser(),
      contractWithContext: withContext(baseContract({ status: 'proposed' }), [pending], 'provider-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.acceptBlockedReason).toBe('start_date_passed');
    expect(contract.actions).toMatchObject({ canAccept: false, canDecline: true });
    expect(contract.timeZone).toBe(WPG);
  });

  it('exposes the negotiated last-day end time with the effective end', async () => {
    const accepted = proposedVersion({
      status: 'accepted',
      decidedAt: new Date(),
      endsOn: '2099-12-11',
      endsAtMinutes: 720
    });
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'active' }), [accepted], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract).toMatchObject({ endsOn: '2099-12-11', endsAtMinutes: 720 });
    expect(contract.acceptedVersion).toMatchObject({ endsAtMinutes: 720 });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts -t "accept|zone|Accept|end time"`
Expected: FAIL — accept succeeds on the start date; detail lacks the new fields.

- [ ] **Step 3: Implement**

Extend the calendar import to `import { addDays, dateIn, todayIn, zoneLabel } from '@repo/calendar';`.

After `StartDateNotInFutureError` add:

```ts
/** Acceptance is refused on or after the start date — cycle 1 must begin
 * after the contract is accepted. */
export class ContractStartDatePassedError extends Data.TaggedError(
  'ContractStartDatePassedError'
)<{}> {}
```

After `contractToday` add:

```ts
/** On or after the start date in the version's zone. A sent version without
 * a start date or zone can't be accepted either (development data only). */
const startDatePassed = (version: ContractVersion) => {
  const today = contractToday(version);
  return version.startsOn === null || today === null || today >= version.startsOn;
};
```

In `acceptContractProgram`, directly after the `isExpired` check add:

```ts
    if (startDatePassed(pending)) {
      return yield* Effect.fail(new ContractStartDatePassedError());
    }
```

In `getContractProgram`, after `const pendingVisible = ...` add:

```ts
    // The zone dates are shown in: the shown version's frozen zone once sent;
    // for the family's own draft, the zone their current location gives.
    const shownVersion =
      accepted ?? (pendingVisible ? pending : null) ?? visibleVersions[visibleVersions.length - 1] ?? null;
    const timeZone =
      shownVersion !== null && shownVersion.status !== 'draft' && shownVersion.timeZone
        ? shownVersion.timeZone
        : isFamily
          ? yield* familyTimeZone(row.familyUserId)
          : null;
    const effective = effectiveEnd(row, accepted);
    const acceptBlockedReason =
      decidable && pending !== null && startDatePassed(pending)
        ? ('start_date_passed' as const)
        : null;
```

In the returned `contract` object, after `endsOn: effectiveEndsOn(row, accepted),` add:

```ts
        endsAtMinutes: effective?.endsAtMinutes ?? null,
        timeZone,
        timeZoneLabel: timeZone ? zoneLabel(timeZone) : null,
        earliestStartsOn: timeZone ? addDays(todayIn(timeZone), 1) : null,
        acceptBlockedReason,
```

and change `canAccept: decidable && !isExpired(pending, cutoff),` to:

```ts
          canAccept: decidable && !isExpired(pending, cutoff) && acceptBlockedReason === null,
```

In the mapper, before `case 'SafetyVerificationRequiredError':` add:

```ts
    case 'ContractStartDatePassedError':
      return c.json(
        {
          error: {
            code: 'CONTRACT_START_DATE_PASSED' as const,
            message: 'The start date has passed — ask the family for new terms with a later date.'
          }
        },
        409
      );
```

- [ ] **Step 4: Run to verify they pass, then build the RPC types**

Run: `cd apps/api && bunx vitest run src/routes/app/contracts/contracts.unit.test.ts`
Expected: PASS (whole file).

Run: `cd apps/api && bunx vitest run` → PASS (whole api suite; conversations tests use `toThreadContractSummary`).

Run: `cd apps/api && bun run build` → exits 0 (refreshes `dist/hc.d.ts` for the web RPC types).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/app/contracts
git commit -m "feat(contracts): refuse acceptance from the start date; zone fields on the detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web — zone label and end time on read-only terms

**Files:**
- Modify: `apps/web/src/lib/contract-sessions.ts`, `apps/web/src/lib/api/contracts.ts`, `apps/web/src/lib/components/contracts/ContractTermsView.svelte`, `apps/web/src/lib/components/contracts/ServiceWizard.svelte`
- Create: `apps/web/src/lib/contract-sessions.test.ts`, `apps/web/src/lib/components/contracts/ContractTermsView.mount.test.ts`

**Interfaces:**
- Consumes: terms responses with `endsAtMinutes` (Task 3), RPC types rebuilt in Task 6.
- Produces: `formatEndTime(minutes: number): string`; `ContractTermsView` prop `timeZoneLabel?: string | null`; `ServiceWizard` prop `timeZoneLabel?: string | null`; `ContractTermsInput.endsAtMinutes?: number | null`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/contract-sessions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatEndTime } from './contract-sessions';

describe('formatEndTime', () => {
	it('formats an end time like session times', () => {
		expect(formatEndTime(720)).toBe('12:00 pm');
		expect(formatEndTime(1050)).toBe('5:30 pm');
	});

	it('reads 1440 as midnight, not 12:00 am of the same day', () => {
		expect(formatEndTime(1440)).toBe('midnight');
	});
});
```

`apps/web/src/lib/components/contracts/ContractTermsView.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ContractTermsView from './ContractTermsView.svelte';

const terms = (overrides: Record<string, unknown> = {}) => ({
	versionId: 'version-1',
	version: 1,
	status: 'accepted',
	proposedByMe: false,
	services: [
		{
			serviceId: 'service-1',
			name: 'Childcare',
			listedRateCents: 2500,
			rateCents: 2600,
			currency: 'CAD',
			sessions: [{ weekday: 4, startMinutes: 540, endMinutes: 1020 }],
			expectations: ''
		}
	],
	startsOn: '2026-10-05',
	endsOn: '2026-12-11',
	endsAtMinutes: 720,
	weeklyEstimateCents: 20800,
	currency: 'CAD',
	sentAt: null,
	expiresAt: null,
	decidedAt: null,
	declineReason: null,
	...overrides
});

describe('ContractTermsView', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it("shows the last-day end time and the family's zone", () => {
		const app = mount(ContractTermsView, {
			target: document.body,
			props: { terms: terms() as never, timeZoneLabel: 'Central Time' }
		});
		flushSync();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).toContain('until 12:00 pm');
		expect(text).toContain("Times are in the family's local time (Central Time)");
	});

	it('shows no end time for an end date without one', () => {
		const app = mount(ContractTermsView, {
			target: document.body,
			props: { terms: terms({ endsAtMinutes: null }) as never }
		});
		flushSync();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).not.toContain('until');
		expect(text).not.toContain('local time');
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && bunx vitest run src/lib/contract-sessions.test.ts src/lib/components/contracts/ContractTermsView.mount.test.ts`
Expected: FAIL — `formatEndTime` is not exported; the view renders neither string.

- [ ] **Step 3: Implement**

`apps/web/src/lib/contract-sessions.ts`: replace the header comment's first two lines

```ts
/** Proposed weekly sessions (Flow F). Times are wall-clock minutes from
 * midnight in New Zealand local time — never UTC — so "3:30–6:00 pm" stays
```

with

```ts
/** Proposed weekly sessions (Flow F). Times are wall-clock minutes from
 * midnight in the contract's own time zone (the family's) — never UTC — so "3:30–6:00 pm" stays
```

and after `formatMinutes` add:

```ts
/** A last-day end time: like session times, except 1440 is "midnight" (the
 * end of that day, not 12:00 am at its start). */
export const formatEndTime = (minutes: number): string =>
	minutes >= MINUTES_PER_DAY ? 'midnight' : formatMinutes(minutes);
```

`apps/web/src/lib/api/contracts.ts`: in `ContractTermsInput`, after `endsOn?: string | null;` add `endsAtMinutes?: number | null;`.

`ContractTermsView.svelte`:
- import: `formatEndTime,` added to the `$lib/contract-sessions` import list.
- `Props` gains `/** "Central Time" — the zone session times are read in. */ timeZoneLabel?: string | null;` and the destructure becomes `let { terms, dimmed = false, heading = 'Services & sessions', timeZoneLabel = null }: Props = $props();`
- directly after the `<h3>…{heading}</h3>` add:

```svelte
	{#if timeZoneLabel}
		<p class="-mt-1 mb-2 text-[11px] text-outline">
			Times are in the family's local time ({timeZoneLabel}).
		</p>
	{/if}
```

- the Ends value becomes:

```svelte
			<span class="font-medium text-base-content">
				{#if terms.endsOn}
					{formatDateWithWeekday(terms.endsOn)}{#if terms.endsAtMinutes}, until {formatEndTime(
							terms.endsAtMinutes
						)}{/if}
				{:else}
					Ongoing
				{/if}
			</span>
```

`ServiceWizard.svelte`:
- `Props` gains `/** "Central Time" — the family's zone, for the copy. */ timeZoneLabel?: string | null;` and add `timeZoneLabel = null,` to the destructure (next to `startsOn`).
- the comment `// 15-minute wall-clock steps across the whole day (NZ local time).` becomes `// 15-minute wall-clock steps across the whole day (the family's local time).`
- the copy line `: ''} · times are NZ local time.` becomes:

```svelte
							: ''} · times are in the family's local time{timeZoneLabel
							? ` (${timeZoneLabel})`
							: ''}.
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && bunx vitest run src/lib/contract-sessions.test.ts src/lib/components/contracts/ContractTermsView.mount.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib
git commit -m "feat(web): show the family's zone and last-day end time on contract terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web — editor end time, start-date minimum, location prompt, detail wiring

**Files:**
- Modify: `apps/web/src/lib/components/contracts/ContractTermsEditor.svelte`, `apps/web/src/lib/components/contracts/ContractDetailPage.svelte`
- Create: `apps/web/src/lib/components/contracts/ContractTermsEditor.mount.test.ts`

**Interfaces:**
- Consumes: detail fields from Task 6 (`timeZone`, `timeZoneLabel`, `earliestStartsOn`, `acceptBlockedReason`); `formatEndTime`; `ServiceWizard`/`ContractTermsView` `timeZoneLabel` props (Task 7); `addDays`, `todayIn` from `@repo/calendar`.
- Produces: `ContractTermsEditor` props `earliestStartsOn?: string | null`, `timeZoneLabel?: string | null`, `locationMissing?: boolean`, `profileHref?: ResolvedPathname | null`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/components/contracts/ContractTermsEditor.mount.test.ts`:

```ts
// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContractTermsEditor from './ContractTermsEditor.svelte';

const initial = {
	versionId: 'version-1',
	version: 1,
	status: 'draft',
	proposedByMe: true,
	services: [
		{
			serviceId: 'service-1',
			name: 'Childcare',
			listedRateCents: 2500,
			rateCents: 2600,
			currency: 'CAD',
			sessions: [{ weekday: 4, startMinutes: 540, endMinutes: 1020 }],
			expectations: ''
		}
	],
	startsOn: '2026-10-05',
	endsOn: '2026-12-11',
	endsAtMinutes: null,
	weeklyEstimateCents: 20800,
	currency: 'CAD',
	sentAt: null,
	expiresAt: null,
	decidedAt: null,
	declineReason: null
};

const baseProps = {
	providerServices: [{ id: 'service-1', name: 'Childcare', hourlyRateCents: 2500 }],
	initial: initial as never,
	listingLabel: "Maria's listing",
	counterpartFirstName: 'Maria'
};

const sendButton = () =>
	[...document.querySelectorAll('button')].find((button) =>
		button.textContent?.includes('Send to Maria')
	) as HTMLButtonElement;

describe('ContractTermsEditor', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('limits the start date to the earliest allowed day', () => {
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: { ...baseProps, onsend: vi.fn(), earliestStartsOn: '2026-09-25' }
		});
		flushSync();
		const min = document.querySelector('#contract-starts')?.getAttribute('min');
		unmount(app);
		expect(min).toBe('2026-09-25');
	});

	it('sends the chosen last-day end time with the end date', () => {
		const onsend = vi.fn();
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: { ...baseProps, onsend }
		});
		flushSync();
		const select = document.querySelector('#contract-ends-at') as HTMLSelectElement;
		select.value = '720';
		select.dispatchEvent(new Event('change'));
		flushSync();
		sendButton().click();
		flushSync();
		unmount(app);
		expect(onsend).toHaveBeenCalledWith(
			expect.objectContaining({ endsOn: '2026-12-11', endsAtMinutes: 720 })
		);
	});

	it('blocks sending and points to the profile while the family has no address', () => {
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: {
				...baseProps,
				onsend: vi.fn(),
				locationMissing: true,
				profileHref: '/family/profile' as never
			}
		});
		flushSync();
		const disabled = sendButton().disabled;
		const link = document.querySelector('a[href="/family/profile"]')?.textContent;
		unmount(app);
		expect(disabled).toBe(true);
		expect(link).toContain('Add your address');
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && bunx vitest run src/lib/components/contracts/ContractTermsEditor.mount.test.ts`
Expected: FAIL — no `min`, no `#contract-ends-at`, Send not disabled.

- [ ] **Step 3: Implement the editor**

`ContractTermsEditor.svelte`:
- add `formatEndTime,` to the `$lib/contract-sessions` import.
- `Props` gains:

```ts
		/** Tomorrow in the family's zone — the start-date picker's minimum. */
		earliestStartsOn?: string | null;
		/** "Central Time" — shown in the session wizard. */
		timeZoneLabel?: string | null;
		/** No saved family address: no zone, so sending is blocked. */
		locationMissing?: boolean;
		/** Where the family adds their address. */
		profileHref?: ResolvedPathname | null;
```

and the destructure adds `earliestStartsOn = null, timeZoneLabel = null, locationMissing = false, profileHref = null,`.
- after the `endsOnOpen` state add:

```ts
	// svelte-ignore state_referenced_locally
	let endsAtValue = $state(initial?.endsAtMinutes ? String(initial.endsAtMinutes) : '');

	/** 12:15 am … midnight, in the session picker's 15-minute steps. */
	const END_TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => (i + 1) * 15);
```

- `clearEndsOn` also resets `endsAtValue = '';`.
- `toTerms` adds `endsAtMinutes: endsOn && endsAtValue ? Number(endsAtValue) : null`.
- the Starts `<input id="contract-starts" …>` gains `min={earliestStartsOn ?? undefined}`.
- directly after the `{/if}` that closes the Ends `{#if endsOnOpen} … {:else} … {/if}` block (still inside the grid `div`), add:

```svelte
		{#if endsOnOpen && endsOn}
			<label class="text-[13px] text-base-content-muted" for="contract-ends-at">
				Last day <span class="text-[11px] text-outline">(optional)</span>
			</label>
			<select
				id="contract-ends-at"
				class="select select-sm w-full text-[13px]"
				bind:value={endsAtValue}
			>
				<option value="">Full scheduled day</option>
				{#each END_TIME_OPTIONS as minutes (minutes)}
					<option value={String(minutes)}>until {formatEndTime(minutes)}</option>
				{/each}
			</select>
		{/if}
```

- in the summary line, after `{#if endsOn}{formatDateWithWeekday(endsOn)}{/if}` add `{#if endsOn && endsAtValue}, until {formatEndTime(Number(endsAtValue))}{/if}`.
- directly before `<div class="mt-4 flex items-center gap-2.5">` (the Send/Save row) add:

```svelte
	{#if locationMissing}
		<p class="mt-3 rounded-lg bg-base-300 px-4 py-3 text-[12.5px] text-neutral" role="alert">
			Session times follow your local time zone, which comes from your address.
			{#if profileHref}
				<a class="font-semibold text-secondary hover:underline" href={profileHref}>
					Add your address
				</a>
				to send.
			{/if}
		</p>
	{/if}
```

- the Send button's `disabled` becomes `disabled={busy || items.length === 0 || locationMissing}`.
- the `<ServiceWizard …>` gets `{timeZoneLabel}`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && bunx vitest run src/lib/components/contracts/ContractTermsEditor.mount.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the detail page**

`ContractDetailPage.svelte`:
- add `import { addDays, todayIn } from '@repo/calendar';`
- `<ContractTermsEditor …>` gains:

```svelte
						earliestStartsOn={contract.earliestStartsOn}
						timeZoneLabel={contract.timeZoneLabel}
						locationMissing={contract.timeZone === null}
						profileHref={resolve('/family/profile')}
```

- `<ContractTermsView …>` gains `timeZoneLabel={contract.timeZoneLabel}`.
- in `termsErrorToast`, before the final `} else {` add:

```ts
		} else if (error.code === 'START_DATE_REQUIRED') {
			toast.error('Pick a start date before sending.');
		} else if (error.code === 'START_DATE_NOT_IN_FUTURE') {
			toast.error('The start date must be after today.');
		} else if (error.code === 'FAMILY_LOCATION_REQUIRED') {
			toast.error('Add your address to your profile before sending.');
```

- in `actionErrorToast`, before the existing `if (` add:

```ts
		if (error.code === 'CONTRACT_START_DATE_PASSED') {
			toast.error('The start date has passed — ask for new terms with a later date.');
			void refresh(contractId);
			return;
		}
```

- replace the `noticeEndsOn` derivation and its comment with:

```ts
	// Recomputed each time the dialog opens (reading endOpen): the notice day in
	// the contract's zone plus 14 calendar days — the same rule the server
	// applies, so a long-lived tab can't show a different date.
	const noticeEndsOn = $derived(
		endOpen && contract?.timeZone
			? formatDateWithWeekday(addDays(todayIn(contract.timeZone), 14))
			: ''
	);
```

- in the decision card, directly after the `{#if contract.actions.canAccept} … {/if}` block add:

```svelte
						{#if contract.acceptBlockedReason === 'start_date_passed'}
							<p
								class="rounded-lg bg-base-300 px-3 py-2 text-[12px] leading-relaxed text-neutral"
								role="status"
							>
								The start date has passed — ask {firstName} for new terms with a later date.
							</p>
						{/if}
```

- [ ] **Step 6: Type-check and run the web suite**

Run: `cd apps/web && bun run check`
Expected: `svelte-check found 0 errors`.

Run: `cd apps/web && bunx vitest run`
Expected: PASS (all web unit/mount tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/contracts
git commit -m "feat(web): end-time field, start-date minimum and location prompt in the contract editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Whole-repo verification and in-app check

**Files:** none new (fixes only if a check fails).

- [ ] **Step 1: No zone leftovers**

Run: `grep -rn "Auckland\|NZ local\|NZ wall" apps packages --include=*.ts --include=*.svelte | grep -v node_modules`
Expected: no output.

- [ ] **Step 2: Lint, types, tests**

Run from the worktree root:

```bash
bun run lint
bun run check-types
cd packages/calendar && bun test src && cd ../..
cd apps/api && bunx vitest run && bun run build && cd ../..
cd apps/web && bun run check && bunx vitest run && cd ../..
```

Expected: every command exits 0. Fix and re-run anything that fails; commit fixes as `fix: …`.

- [ ] **Step 3: Run the app**

Start the stack from this worktree (after Task 2 Step 5 it is already this worktree's): `docker compose up -d`, then `docker restart api` (the api container misses host edits). Add or point the root `.claude/launch.json` web entry at `contract-dates/apps/web` on a port listed in `TRUSTED_ORIGINS`, and start it with the preview tool. Create test users and a conversation as described in the dev-environment notes (family needs latitude/longitude + city/state; provider needs services, approval and verified safety verification).

Verify in the browser, taking a screenshot of each:
1. Family draft: the start-date picker's minimum is tomorrow; the wizard reads "times are in the family's local time (Central Time)" for a Winnipeg address.
2. Setting an end date shows "Last day", choosing "until 12:00 pm" shows ", until 12:00 pm" in the summary; after sending, the provider's terms view shows it.
3. Family with the coordinates cleared (`UPDATE app_db.user_profile SET latitude = NULL, longitude = NULL WHERE user_id = '<family id>'`): the address prompt shows and Send is disabled.
4. Provider on a proposal whose start date is today (`UPDATE app_db.contract_versions SET starts_on = CURRENT_DATE WHERE id = '<version id>'`): no Accept button, the "start date has passed" message shows, Decline still works.

- [ ] **Step 4: Commit any fixes and report**

```bash
git status --short
```

Expected: clean. Report results (commands run, pass/fail, screenshots) to the user before any push or PR.
