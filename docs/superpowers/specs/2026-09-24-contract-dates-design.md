# Contract dates — design (piece 1 of contract billing)

Status: **approved 2026-09-24**. Piece 1 of the
[Stripe contract-billing umbrella design](2026-09-24-stripe-contract-billing-design.md).
No Stripe work here; this piece makes contract dates correct so billing
(piece 3) can be built on them.

## Goal

Contract dates, session times and "today" are computed in the **family's own
time zone**, frozen per contract, instead of the `Pacific/Auckland` literal
the code uses today (a 19–21 h offset from Canada that puts derived dates on
the wrong calendar day). Start-date rules are enforced at send and accept, and
the last day can end at a set time.

## Rules

1. Each contract version carries an IANA `time_zone`, derived from the
   family's saved latitude/longitude when the terms are **sent**, and frozen
   when the version is **accepted**.
2. Everything contract-related that means "today" or a calendar date uses that
   zone. Everything else in the app is UTC; browsers format instants in the
   viewer's zone.
3. Sending requires a start date **later than today** in the family's zone.
4. Accepting is refused **on or after** the start date (today in the
   version's zone `>= starts_on`).
5. A negotiated end date may carry an optional **last-day end time**. Sessions
   on the last day are cut at it: a session crossing it is shortened, a session
   starting at or after it is dropped. A contract ended by notice works the full
   schedule on its last day; when both end dates exist the earlier wins, and
   the end time applies only when the negotiated date wins.
6. Session lengths for billing are **real elapsed minutes** in the contract
   zone (3 h / 5 h on DST nights for a 01:00–05:00 session). A non-existent
   wall time moves forward; an ambiguous one takes the first occurrence.
   Sessions never cross midnight (unchanged).
7. The notice period's last working day is the contract-zone date of the
   notice moment **plus 14 calendar days**.

## 1. `@repo/calendar` (new package)

Leaf package, pure functions, the only code that knows about time zones.
Uses `temporal-polyfill` (Temporal's default `'compatible'` disambiguation is
exactly rule 6) and `@photostructure/tz-lookup`.

| Function | Signature (sketch) | Behaviour |
|---|---|---|
| `zoneForLocation` | `(lat: number, lng: number) => string` | IANA zone for a point. Server-only entry point (`@repo/calendar/lookup`) so the lookup data never reaches the browser bundle |
| `todayIn` | `(zone: string, now?: Date) => IsoDate` | Calendar date in `zone` at `now` |
| `dateIn` | `(at: Date, zone: string) => IsoDate` | Calendar date of an instant in `zone` |
| `addDays` | `(date: IsoDate, days: number) => IsoDate` | Pure calendar arithmetic |
| `instantAt` | `(date: IsoDate, minutes: number, zone: string) => Date` | Wall-clock minutes (0–1440; 1440 = next midnight) on `date` → UTC instant; gap → forward, overlap → earlier |
| `sessionElapsedMinutes` | `(date: IsoDate, session: {startMinutes, endMinutes}, zone: string, endCapMinutes?: number) => number` | Real minutes between the two instants; `endCapMinutes` applies rule 5 (0 when the session starts at/after the cap). No consumer until piece 3 |
| `zoneLabel` | `(zone: string, locale?: string) => string` | Generic name ("Central Time") via `Intl.DateTimeFormat` `timeZoneName: 'longGeneric'` |

`IsoDate` is a branded `YYYY-MM-DD` string. The root export (everything except
`zoneForLocation`) is browser-safe.

Tests pin: DST spring/fall in `America/Winnipeg` and `America/Toronto`,
`America/Regina` (no DST), `America/St_Johns` (half-hour offset), midnight
boundaries (23:30 local already tomorrow in UTC), month/year rollover in
`addDays`, lookups for Winnipeg, Regina, Kenora (Central, in Ontario),
Cranbrook (Mountain, in BC), Toronto, Vancouver, St. John's.

## 2. Data model — migration `0024_contract_dates.sql`

Hand-authored (see AGENTS/dev notes: no `drizzle-kit generate`), journal entry
added by hand.

```sql
ALTER TABLE app_db.contract_versions
  ADD COLUMN time_zone text,
  ADD COLUMN ends_at_minutes integer;

-- Development data only (nothing in staging/production): give every sent
-- version a zone so the check below holds.
UPDATE app_db.contract_versions
  SET time_zone = 'America/Winnipeg'
  WHERE status <> 'draft' AND time_zone IS NULL;

ALTER TABLE app_db.contract_versions
  ADD CONSTRAINT contract_versions_time_zone_when_sent
    CHECK (status = 'draft' OR time_zone IS NOT NULL),
  ADD CONSTRAINT contract_versions_ends_at_minutes_valid
    CHECK (ends_at_minutes IS NULL
           OR (ends_on IS NOT NULL AND ends_at_minutes BETWEEN 1 AND 1440));
```

- `time_zone` is written at send and never touched after acceptance (accepted
  versions are immutable). A proposal withdrawn back to draft keeps its zone;
  the next send overwrites it.
- `starts_on` stays nullable in the schema (drafts); required at send in the
  API.
- `ContractSession` and schema comments lose "NZ / Pacific/Auckland": session
  minutes are wall-clock in the version's `time_zone`.
- Drizzle schema (`packages/db/src/schema.ts`) and `ContractRepo`
  (`updateVersionTerms`, `sendPendingVersion` or equivalent) gain the two
  fields.

## 3. API (`apps/api/src/routes/app/contracts`)

Removed: `nzIsoDate`, `todayIsoDate`, the `DAY_MS` notice arithmetic.

Added: `contractToday(version)` = `todayIn(version.timeZone)`; used by every
rule below.

**Validator.** `contractTermsSchema` accepts `endsAtMinutes?: number | null`
(int, 1–1440), and a filter requires `endsOn` when it is set.

**Send** (`sendContractProgram`), after the existing state/empty/rate checks:

| Check | Error | Status |
|---|---|---|
| `pending.startsOn` is null | `StartDateRequiredError` / `START_DATE_REQUIRED` | 422 |
| family profile has no latitude/longitude | `FamilyLocationRequiredError` / `FAMILY_LOCATION_REQUIRED` | 422 |
| `startsOn <= todayIn(zone)` | `StartDateNotInFutureError` / `START_DATE_NOT_IN_FUTURE` | 422 |

The zone is written with the refreshed services in the same
`updateVersionTerms` call that precedes `sendPendingVersion`.

**Accept** (`acceptContractProgram`), after the expiry check:
`contractToday(pending) >= pending.startsOn` → `ContractStartDatePassedError` /
`CONTRACT_START_DATE_PASSED`, 409.

**Read-time dates.**
- `presentedContractStatus`: "ended" when the effective end date `<`
  `contractToday(accepted)`.
- `noticeEndsOn`: `addDays(dateIn(endNoticedAt, accepted.timeZone), 14)`.
- `effectiveEndsOn` unchanged in shape; also returns which source won so the
  end time is shown only for the negotiated date.
- `endContractProgram` and the `contract.ended` notification use the same
  functions.

**Detail DTO** adds:
- `timeZone: string | null`, `timeZoneLabel: string | null` — the shown
  version's zone; for a draft, derived from the family's current location
  (`null` when they have none).
- `endsAtMinutes: number | null` (negotiated end only).
- `earliestStartsOn: IsoDate | null` — `addDays(todayIn(zone), 1)`.
- `acceptBlockedReason: 'start_date_passed' | null`, with `canAccept` false
  when set.

**Error handling.** New tagged errors are mapped by `_tag` in the response
mapper, ending in `handleNever` (AGENTS.md). Route error types stay derived
from the programs.

**Tests.** Unit tests on the programs with test layers: each send failure,
send success writes the zone, accept refused on/after the start date and
allowed the day before (across a UTC midnight), notice end date across a DST
change and a month boundary, presented status in a non-Winnipeg zone, DTO
fields for drafts with and without a family location.

## 4. Web (`apps/web`)

- **`ContractTermsEditor`**: date picker `min` = `earliestStartsOn`; when an
  end date is set, an optional **"Last day ends at"** time select (15-minute
  steps, same options as the session picker); clearing the end date clears it.
  With no family location, an inline prompt links to the family profile
  address step and Send is disabled.
- **`ServiceWizard`**: "times are NZ local time" → "Times are in the family's
  local time ({timeZoneLabel})".
- **`ContractTermsView` / `ContractDetailPage`**: zone label beside the week
  strip; dates line shows "→ Fri 12 Dec 2026, until 12:00 pm" when an end time
  exists; when `acceptBlockedReason === 'start_date_passed'` the provider sees
  "The start date has passed — ask the family for new terms with a later date"
  instead of Accept.
- **Errors**: send/accept failures surface as toasts with the API message
  (AGENTS.md).
- **`contract-sessions.ts`**: comments no longer say NZ; weekly estimate stays
  pattern-based (wall-clock minutes).
- **Tests**: update `contracts.mount.test.ts`; add coverage for the end-time
  field, the blocked-accept message and the zone label.

## Out of scope

Billing, holds, cycles and anything Stripe (pieces 2–5). Converting session
times into the viewer's zone. Overnight sessions. Re-contracting after an
ended contract.

## Done when

- No `Pacific/Auckland` / "NZ" references remain in contract code or UI copy.
- Migration applies on a fresh stack and on existing development data.
- API unit tests and web mount tests pass; `svelte-check`, lint and the api
  build (web RPC types) pass.
- In the running app: a family in Winnipeg can't send a start date of today,
  a provider can't accept on the start date, the wizard shows "Central Time",
  and an end time appears on the terms.
