# Family Provider Search — UI Design Brief

Scope: the family-facing marketplace discovery experience — searching, filtering, and viewing service providers. This brief is the hand-off for UI design only; implementation follows after designs are approved.

Out of scope for this iteration (do not design flows for these, but leave visual affordances where noted): messaging/contact between family and provider, contractual agreements, ratings, availability calendar, payments.

## Context

Poppynz is a caregiving marketplace ("TaskRabbit for Mom Helpers"). Service providers (nannies / major-dommos) complete onboarding, upload KYC documents, and are vetted and approved by an admin before they become searchable. Families browse and search this pool of **approved providers only** — every provider a family can see has passed vetting. This trust signal is central to the product and should be visible in the UI.

Users on these screens are **authenticated family accounts** (passwordless magic-link auth and family onboarding already exist). There is no anonymous/public search in this iteration.

## What data exists per provider (hard constraint)

The search index exposes exactly this per provider — do not design around data we don't have:

- Name: `displayName` (first + last; can be null — design a fallback, e.g. "Provider in {city}")
- Profile photo (can be null — fall back to an initials avatar)
- `shortBio` (free text, can be null)
- Location: `city`, `stateProvince`, `country`, plus `distanceKm` (rounded to 0.1 km, only present when searching around a point)
- Services: list of provider-written service names + optional descriptions (free-form text, NOT a fixed taxonomy — e.g. "After school babysitting")
- Rates: `minHourlyRateCents` / `maxHourlyRateCents` across the provider's services, plus per-service hourly rate on the detail view. **All rates are in CAD** — display as "$28/hr"; no currency filter or currency switcher anywhere.
- Approval expiry (internal — used only to guarantee everyone shown is currently vetted)

ratings/reviews, availability, response time, years of experience, verified-hours count. Do not show placeholder stars or fake stats.

> **Implementation note — profile pictures (not relevant to design):** the profile picture is stored as a rustfs index (file key) of the picture, not a URL. That same index is what gets indexed into Typesense. At load time, the API takes the index, generates the authorization link from it, and inserts that link in place into the profile/search response. The frontend always receives a ready-to-render authorized URL and never sees or resolves the raw index itself. These links are generated per response, so treat them as short-lived: don't cache them long-term or persist them client-side.

## Screens to design

### 1. Search / browse page (the marketplace)

The family's main discovery surface. Reached from the family dashboard via a prominent "Find help" entry point (also design that dashboard tile/nav item).

**Search controls:**
- Keyword search input — searches names, bios, and service names ("newborn", "after school pickup", a provider's name). Prominent, top of page.
- Location control — defaults to the family's saved home location (captured during onboarding). Shows the current search origin as a readable label (e.g. "Near Ponsonby, Auckland") with the ability to change it via Google Place autocomplete. Paired with a **radius selector** (e.g. 5 / 10 / 25 / 50 km presets).
- Filters:
  - Service — facet values from the index (free-form names, so expect a long-ish list; a searchable multi-select or chip list, not a tiny fixed set)
  - Hourly rate — min/max range (slider or two fields)
  - City — facet select (secondary; radius search is the primary geo tool)
- Sort — relevance (default when keyword present), distance (default when browsing by location), price low→high, price high→low, newest.
- Active filters shown as dismissible chips with a "clear all".

**Results:**
- Result count ("34 vetted providers near you").
- Card list/grid (see card spec below), paginated (page-number pagination; ~12–20 per page).
- Desktop: filters in a left rail or top filter bar; results as a 2–3 column card grid or generous single-column list — designer's call.
- Mobile: single-column cards; filters collapse into a bottom sheet / drawer behind a "Filters" button showing an active-filter count badge.

**States (design all of these):**
- Loading — skeleton cards.
- Empty (no matches) — friendly illustration + suggestions: widen the radius, remove filters, try a different term. One-tap "expand radius" action.
- Empty (new area, no providers at all) — softer message: "We're growing in your area"; no self-blame framing.
- Error — retry affordance.

### 2. Provider card (within results)

Each card shows:
- Profile photo (initials-avatar fallback when the provider has none)
- Name (or fallback), with a **"Vetted" badge** — every listed provider is admin-approved; the badge reinforces trust rather than differentiating
- Location line: "Suburb/City, Region" + distance chip when geo-searching ("2.3 km away")
- Rate: single value "From $28/hr" when min = max range collapses, else "$25–$40/hr"
- Short bio, truncated to ~2 lines
- Service chips: first 2–3 service names + "+N more"
- Whole card clickable → provider profile

No stars, no response time, no availability dots.

### 3. Provider public profile (detail page)

What a family sees when they tap a card. This is the provider's shop window — warm and trustworthy, not a form readout.

- **Header:** large profile photo (initials-avatar fallback), name, Vetted badge, "Suburb/City, Region" + distance, rate summary ("From $28/hr").
- **About:** the short bio in full.
- **Services & rates:** the core section. Each service: name, description, hourly rate. List or cards; rates prominent and scannable.
- **Location:** approximate only — city/suburb level. If a map is used, show a shaded circle/area around the general location, never an exact pin or street address (safety requirement: provider home addresses must not be inferable).
- **Trust panel:** small section explaining what "Vetted" means (identity and background documents reviewed and approved by Poppynz). Builds marketplace trust; keep it brief.
- **CTA area:** design a primary "Contact {name}" button as a visual placeholder — messaging ships next iteration, so the button's disabled/coming-soon treatment should be graceful (e.g. enabled-looking button that opens a "Messaging is coming soon" note, or a tasteful "coming soon" tag). Designer's call, but the layout must not need rework when messaging lands.
- Back navigation preserving search state ("Back to results").
- Mobile: same content, single column; sticky bottom CTA bar is welcome.

### 4. Family dashboard entry point

The family dashboard exists (post-onboarding). Add the discovery entry: a hero tile or primary nav item ("Find help near you") leading to the search page, ideally previewing 2–3 nearby provider cards to pull the family in.

## Tone & principles

- Trust-first: vetting is the differentiator; make it felt without being clinical.
- Warm, family-friendly, consistent with the existing conversational onboarding style.
- Privacy-safe geo: distances and suburb-level locations only, on both sides.
- Honest data: nothing fabricated — no fake ratings, photos, or activity signals.
- Responsive from 375px mobile up; mobile is expected to be the dominant family device.

## Deliverables requested from design

1. Search/browse page — desktop + mobile, including filter drawer/sheet and all four states (loading, results, empty, error)
2. Provider card component — all data variants (with/without photo, no name, no bio, one service, many services, single rate vs range, with/without distance)
3. Provider profile page — desktop + mobile
4. Family dashboard entry point
