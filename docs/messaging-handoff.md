# Messaging (Flow E §16a–16c) — implementation handoff

Branch `feature/2-way-messaging` (worktree `messaging/`), all work uncommitted as of 2026-08-07.
Design source: claude.ai/design project "Poppynz UI Design Hand-off" → `Poppynz Flow E - Messaging.dc.html`.
Sections **16a–16c (messaging) are built**; **16d–16j (contracts) are intentionally NOT built** — this doc ends with how they plug in.
Status: API tests 300/300, web unit tests 20/20, `svelte-check` and `eslint` clean, full flow verified in the running app (fresh reach-out → respond → live chat → realtime toasts/badges/modals).

## 1. What exists

### Data (`packages/db`)

- `conversations` + `conversation_messages` — migration `src/migrations/0010_messaging.sql`, schema in `src/schema.ts`, repo `src/repos/conversation-repo.ts`.
- One **live** conversation per family↔provider pair (partial unique index on `deleted_at IS NULL`). A conversation _is_ the reach-out: `initiator_user_id`, rendered `reachout_message` (server-templated, never free text), `reachout_services` jsonb snapshot `{serviceId, name}[]`, `status pending|active|ignored`, per-side `family/provider_last_read_at` read markers.

### Reach-out semantics (the subtle part — don't break these)

- **Ignore is secret**: the initiator is shown `pending` forever (`presentedStatus`), identical error codes to real pending everywhere, no notification on ignore. The ignorer loses the thread from their **list** but keeps **detail/lookup** access so they can revive it.
- **Cool-down**: `REACHOUT_IGNORE_COOLDOWN_DAYS` env (default 120, in `packages/env`). Within the window: initiator sees pending, ignorer can revive by hitting Respond, ignorer-initiated re-reach-out gets a vague 409 `REACHOUT_UNAVAILABLE`. Past it: the row is treated as nonexistent everywhere and soft-deleted when either side reaches out afresh.
- Provider-**initiated** reach-outs require a live approval (mirrors the familySearch gate); respond/message in existing threads survive revocation.
- Concurrent reach-out race: unique-violation (23505) is caught → re-lookup → 409 `CONVERSATION_EXISTS`.

### API (`apps/api/src/routes/app/conversations/`)

Permission `conversation: ["read","write"]` (`lib/auth-roles.ts`). Endpoints under `/api/v1/conversations`:
`POST /` (create reach-out) · `GET /` (list + unreadTotal) · `GET /me/unread-count` · `GET /lookup?userId=` (drives profile CTA state) · `GET /:id` (thread) · `POST /:id/respond` · `POST /:id/ignore` · `POST /:id/messages` · `POST /:id/read`.
Standard Effect route-program pattern per AGENTS.md; unit tests in `conversations.unit.test.ts` cover success paths, authz, secrecy, cool-down, revive, and the 23505 race.

### Realtime backbone (`packages/notify` — built to be reused)

- `NotificationHub` Effect service: Redis pub/sub on `notify:user:<id>`, envelope `{id, type, createdAt, payload}`. Typed catalogue in `src/events.ts`; web imports it **type-only** via `@repo/notify/events`. Publish with `publishNotificationBestEffort` (never fails the mutation).
- One SSE endpoint: `GET /api/v1/notifications/stream` (`apps/api/src/routes/app/notifications/notifications.ts`), session-cookie auth, 15s heartbeats.
- **Gotcha that cost hours**: Bun's default `idleTimeout` is 10s and silently kills quiet SSE connections. `apps/api/src/index.ts` exports `{ fetch, idleTimeout: 120 }`. Keep heartbeat < idleTimeout. (Also: `docker restart api` after apps/api edits; rebuild `apps/api` (`bun run build`) after route changes or web RPC types silently degrade.)
- Events published today: `conversation.reachout|unlocked|message` (conversations handler), `approval.decided|revoked` (approval + approval-requests handlers).

### Web (`apps/web`)

- `/family/messages` + `/service-provider/messages` → shared `lib/components/messages/MessagesPage.svelte` (list pane + thread pane; `?c=<id>` selects — on mobile that's the list↔chat screen switch, browser back pops chat→list). `ReachoutCard.svelte` (full card while pending with Respond/View profile/Ignore for the receiver; collapses to summary + "unlocked" pills once active). Own messages and own reach-out render right, counterpart left.
- Composer: `ReachoutComposerModal.svelte` (16a) — locked template preview, service chips from the _receiver-relevant_ set (family picks from provider's offering, provider from family's needs). Entry points replaced the "coming soon" stubs on `family/providers/[userId]` and `service-provider/families/[userId]`; the CTA is lookup-driven (no conversation → composer; existing → "Message" link into the thread).
- Realtime client: `lib/notifications.svelte.ts` (reconnecting EventSource singleton, `notifications.on(type, cb)`); `lib/unread.svelte.ts` store behind the pink sidebar "Messages" badge (badge counts _conversations_ with news, not messages); `lib/components/RealtimeNotifications.svelte` mounted in both role layouts — toasts for conversation events (suppressed on the Messages page), and an **interrupting modal** (`ApprovalDecisionModal.svelte`) for approval decisions unless the user is on the approval page.
- Svelte 5 traps already handled (don't regress): thread `$effect` depends only on the URL param (`loadedThreadId` guard — reading state you set inside an `$effect` = infinite refetch loop); stale in-flight fetches are discarded; keyed `{#each}` uses ids, never user-authored names; filter `<fieldset>`s need `min-w-0` (UA default `min-inline-size: min-content` makes them overflow their rail).

## 2. How contracts (16d–16j) embed into this

Design intent (16g): **anti-spam is structural** — contract creation has _no entry point outside an unlocked conversation_, and only on the family side. Everything contracts need is already exposed:

1. **Entry points (16g)**
   - Thread header in `MessagesPage.svelte` is the designated spot for **"Propose terms"**: render it when `thread.conversation.status === 'active'` **and the viewer is the family side** (`conversation.counterpart.role === 'service-provider'`). Deep-link it pre-filled from the thread: counterpart = `conversation.counterpart.userId`, services = `conversation.reachout.services`.
   - Profile pages: after unlock, `lookupConversation()` already returns `{status: 'active'}` — add the second button beside "Message" (16g panel 2).
   - Contracts list/detail are **their own pages** (16e/16f) — `/family/contracts`, `/service-provider/contracts` — no "New contract" button anywhere; the empty state points to Messages (16g panel 3). Add the nav items in both role `+layout.svelte`s (SidebarItem hrefs must be `resolve()`d — the type enforces it).
2. **Data**: a new `contracts` table should reference `conversation_id` (provenance + the only creation gate: handler must load the conversation, verify the caller is its **family participant** and status is `active`). Keep chat pure — no contract rows in `conversation_messages`; contract state lives only in the Contracts tab per the reach-out model.
3. **Permissions**: add `contract: ["read","write"]` to `appAc` + roles in `lib/auth-roles.ts` — the create program then checks family-side-of-this-conversation structurally (like `conversation` does), not by role guard.
4. **Realtime — zero transport work**: add entries to `NotificationPayloads` in `packages/notify/src/events.ts` (names already sketched there in a comment: `contract.proposed|accepted|declined|ended` with `{contractId, counterpartName}`), call `publishNotificationBestEffort(recipientId, …)` at each mutation site, and subscribe in `RealtimeNotifications.svelte` choosing the surface (toast vs modal — accept/decline probably deserve the modal treatment like approvals). SSE, reconnect, badge plumbing all exist.
5. **Contact-details reveal**: the composer's privacy note promises "contact details stay hidden until you have an **active contract**" — the accept flow (16h) owns implementing that reveal.
6. **Reference screens**: 16d draft detail, 16e list, 16f detail (receiver decides / sender waits), 16h accept & decline, 16i active + ending, 16j declined both POVs — all in `Poppynz Flow E - Messaging.dc.html`.

## 3. Dev environment quick facts

- Docker stack: compose project is fixed (`name: "poppynz_dev"`); bring it up from this worktree so mounts point here. Redis already serves BullMQ + the notification hub.
- Repo-root `.claude/launch.json` `web` → `messaging/apps/web` on 5173.
- Seeded test data on the running stack: `family@test.dev` (Priya) ↔ `provider@test.dev` (Maria, approved to 2027-08-06) have an **active** conversation; `family2@test.dev` (Dana) → Maria is an **ignored** reach-out (cool-down testing). Admins: `springfield@poppynz.com`. Magic links are `console.log`ged — `docker logs api | grep "Magic link"`.
