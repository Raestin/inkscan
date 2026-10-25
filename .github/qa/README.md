# Promo scanner and Standard-filter candidate validation

This hidden CI directory constructs a disposable localhost copy of the **actual candidate runtime**. Root retains the production configuration, the 3,505-row Lorcast catalog and existing assets; the six source-verified Hyperia PD1 #9–14 promos are a separate `promo-catalog.json` overlay with transparent `tcgplayer_` IDs. No user photos, collection, session, email or private database snapshots are published.

## Scope

- Separate promo/special printing scope from physical finish; paginated name and exact-reference search.
- Authoritative P-series/PD1 footer identity, full collector suffixes, and explicit ambiguity/missing-printing review. No regular-set fallback and no guess from a stamp or foil flag.
- Six verified supplemental printings, reapplied to bundled/cache/refreshed catalogs without replacing prior IDs. Distinct provider, stamp and provenance are shown. Artwork remains a placeholder, never borrowed from the base card.
- Six exact `Holofoil (provider label)` market quotes apply only to generic Foil counts for those exact promo products. Normal/Rainbow remain unpriced; future, stale (>7 days), mismatched or unavailable quotes never fall back. Existing rainbow quotes and their semantics are preserved.
- Provider-neutral versioned CSV exports, complete old v6 and legacy import compatibility, and ambiguous set/collector fallback rejection. Existing v6 storage, backups, manual sync, unknown-ID retention and legacy-change fences remain.
- Dated English Core Constructed (Standard) card-pool filter in Collection and Browse. Exact full-name/version reprints are eligible; versions, future sets and unknowns are not guessed. Official snapshot verified October 25, 2026, covers released sets 9–14; it has no Core bans and does not reuse stale provider legality flags. The app requires maintenance review by November 24, 2026 and reports Unknown from that date until refreshed—this is an app freshness guard, not an official rotation date.
- The deck-picker eligibility dropdown is intentionally deferred: legacy saved deck keys can merge punctuation-distinct special-format identities. No deck-key migration or claim that a special-format copy satisfies a Standard card is introduced. Use exact-printing Collection/Browse/details for eligibility; the builder is not a format validator.
- Existing deck badges explicitly say size/ink checks only, not complete deck legality. Filters never edit saved decks or physical ownership.
- Asset cache v8; no forced service-worker takeover, storage clearing or automatic cloud sync.

## Validation and safety

`verify-release.cjs` checks unchanged production constants/assets, catalog and quote hashes, all original printing identities, six supplemental identities/quotes, dated rules identity/count/freshness safeguards, and asset wiring. `prepare-fixture.cjs` substitutes only synthetic cards and disabled cloud constants into a disposable copy. The synthetic tests never authenticate or read/write a real collection.

Local syntax/release verification and **157 unit/reference checks** pass at this preparation checkpoint. Five unit checks concern a non-shipping household reference model. The 84 desktop/mobile browser checks and the existing pinned disposable PostgreSQL/PostgREST compatibility test must pass in hosted CI before release. Browser routing blocks external/production traffic and service workers; it does not verify physical camera accuracy, Safari, live authenticated sync or offline worker lifecycle. OCR parser fixtures are text, not a claim of camera testing.

The workflow uses same-repository, exact-branch gating, read-only permissions, pinned official actions and Playwright, bounded runtime and seven-day synthetic artifact retention. It has no deploy or production database step. Historical `.github/proposals` rainbow SQL remains deliberately aborting and is not executed by this workflow; the separately approved previous rainbow migration is already complete.

Current production/rollback code reference: `d92595211fa960816f77b551bcb266996b348722`. This candidate requires independent source review, green exact-head CI and explicit deployment approval before merge. It changes no database schema, RLS, credentials, inventory, decks, wishlist or household access. Do not replay any earlier inventory/deck operation.
