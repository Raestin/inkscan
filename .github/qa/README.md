# Exact promo artwork validation

This artwork-only candidate starts from production `5e37b40a92fd1f371aee607f058b785d243c0575`. It connects the six already-verified Hyperia prerelease printings (PD1 #9–14) to their exact public stamped artwork. It does not substitute the regular printing, infer finish, or change quantities, decks, prices, Standard rules, credentials, schema or permissions.

## Scope and preservation

- Optional explicit artwork metadata is bound to the same provider product and full printing identity. Only validated external HTTPS image routes are rendered. No user photograph or copied card-image asset is committed to the repository.
- The source image is used in Scan search, list/grid cards and details. Image errors display an identified placeholder; promo images never fall back to base-card artwork. External image elements suppress the referring page URL.
- Existing managed promo records may gain/remove only their validated artwork metadata; conflicting identities are never repaired or aliased. Raw Lorcast image/version fields remain untouched.
- `artwork-baseline.json` binds all 14 unrelated runtime files and every pre-existing promo-catalog property. Existing catalog, finish quotes, safety/storage/sync code and dated Core rules remain exact.
- Asset cache v9 uses the normal service-worker lifecycle. No forced takeover, browser-storage clearing or automatic cloud sync.

## Verification

`verify-release.cjs` checks unchanged production constants/assets, all original printing identities, unchanged quotes/rules, the six artwork mappings and cache wiring. `prepare-fixture.cjs` builds a disposable localhost copy of this actual candidate, replacing only cloud constants and synthetic ownership/catalog inputs. No production session or collection is loaded.

Local syntax, preservation verification and **169 unit/reference checks pass**. The **94 desktop/mobile checks** must pass in hosted CI before release. The existing desktop/mobile regressions remain, with new artwork tests that require real decoded image dimensions (`naturalWidth`/`naturalHeight`), not merely an `<img>` tag. The six public assets are fetched by a bounded exact-URL preflight, then their actual bytes are served through exact browser route interceptions. No app request is allowed to reach production database/auth services. Source URL health and downloaded bytes are recorded separately from browser pixel checks; this does not promise every phone/network will accept external image loading.

The workflow uses same-repository, exact-branch gating, read-only permissions, pinned official actions and Playwright, bounded runtime and seven-day synthetic test retention. It has no deployment or production database step. Service workers are blocked in browser QA: offline/PWA lifecycle, Safari and physical camera recognition are not covered. Historical deliberately-aborting rainbow SQL proposals are not executed.

Publication and deployment are explicitly authorized for this bounded artwork fix, conditional on independent source review, exact-head green CI and visual review. Do not replay earlier inventory or saved-deck operations. The previous production SHA above is the code rollback reference, not a data rollback.
