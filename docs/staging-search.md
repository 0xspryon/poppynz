# Search on staging: "Something went wrong on our side" (UAT #26)

Find help (`GET /providers`) and Find families (`GET /families`) returned a
502 on app.staging.poppynz.com for both test accounts on Oct 11 and 12, 2026.
It does not reproduce locally. This note lists the likely causes, what the
code now does about them, and what to check on staging.

## What changed in the code

- **Missing collection or alias → empty results, not an error.** Search reads
  through the alias (`TYPESENSE_*_COLLECTION_ALIAS`), which is created only by
  a reconcile or a reindex. After the family collection was bumped to
  `families_v2`, an environment where no reconcile ran yet answered every
  search with a Typesense 404, which surfaced as a 502. Search now logs
  `typesense: collection "<alias>" not found during search — creating it; run
  the admin reindex to repopulate it`, creates the collection and alias, and
  returns an empty page (`packages/typesense/src/recover.ts`).
- **Other Typesense failures are logged with their cause**
  (`typesense: search on "<alias>" failed`) and answered with **503**
  `PROVIDER_SEARCH_FAILED` / `FAMILY_SEARCH_FAILED`. A 502 in the browser now
  means the reverse proxy (the API is down or timed out), not our handler.
- **A photo that can't be signed no longer fails the search.** Each result's
  photo is a presigned object-storage link; a storage or env problem
  (`OBJS_PUBLIC_BUCKET`, `RUSTFS_*`) used to fail the whole request with a 502.
  Results now come back without the photo and the API logs
  `search: profile photo could not be signed`.
- **The city filter is optional.** A facet failure leaves the dropdown empty
  instead of failing the results (`search: city facets unavailable`).
- The web pages show a clear error state with **Try again** when search is
  unavailable, and an empty state when there are no results.

## What to check on staging

1. **API logs** while searching, for the messages above. A proxy 502 with no
   API log line means the API container restarted or timed out — check its
   health and memory.
2. **Env** on the api and worker services (both must match):
   `TYPESENSE_HOST`, `TYPESENSE_PORT`, `TYPESENSE_PROTOCOL`, `TYPESENSE_API_KEY`,
   `TYPESENSE_PROVIDER_COLLECTION_ALIAS` / `_VERSION`
   (defaults `service_providers_current` / `service_providers_v1`),
   `TYPESENSE_FAMILY_COLLECTION_ALIAS` / `_VERSION`
   (defaults `families_current` / `families_v2`), `OBJS_PUBLIC_BUCKET`,
   `RUSTFS_PUBLIC_ENDPOINT`.
3. **Aliases exist**:
   `curl -H "X-TYPESENSE-API-KEY: $KEY" $TYPESENSE/aliases` should list both
   `service_providers_current → service_providers_v1` and
   `families_current → families_v2`.
4. **Reindex both sides** as an admin (signed-in admin session cookie):
   `POST /api/admin/provider-search/reindex` and
   `POST /api/admin/family-search/reindex`. The worker must be running to
   process the jobs. Re-run after any collection-version bump.
5. Retest with a **normal sign-in** as well as through Impersonate.
