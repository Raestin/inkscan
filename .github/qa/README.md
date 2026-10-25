# Original no-image placeholder validation

This candidate is rebuilt from production `5e37b40a92fd1f371aee607f058b785d243c0575`. The user replaced the external-artwork request with an original themed **No image available** placeholder. The rejected external-image and photo-crop approaches are cancelled, not pending.

## Bounded scope

- An original repository-native SVG uses abstract blue/purple ink swirls, gold accents and a neutral missing-image symbol. It contains no official logo, actual card artwork, user photograph, script or external resource.
- Visible HTML says **No image available** and retains the exact escaped card name/version/printing identity. The decorative SVG is only a background; the text remains readable if that asset fails.
- Missing artwork and failed real image requests use this placeholder across grids, thumbnails and card details. Existing valid Lorcast image URLs remain byte-identical. Actual card images have `data-card-art`; the placeholder is not reported as loaded card art.
- Detail images retain one bounded normal-to-small fallback, then reveal the placeholder. No error loop or regular-card substitution for a promo.
- All 15 unrelated runtime files remain byte-exact, including catalogs, prices, rules, storage/sync safety and configuration. No database, inventory, deck, schema, permission, credential or policy changes.
- Cache v9 includes the local SVG and uses the normal worker lifecycle. No forced takeover, storage clearing or automatic sync.

## Checks and limitations

`placeholder-baseline.json` and `verify-release.cjs` bind the unchanged runtime and original image URL helper. The cancelled external-art downloader and mappings are absent. Tests preserve the previous regression suite and add actual placeholder rendering, SVG decoding, accessible naming, missing-SVG text fallback, valid-card-image preservation and bounded HTTP/decode failure handling.

The disposable localhost copy uses synthetic ownership and disabled cloud constants. For valid/failed card-image rendering tests only, a strict single-constant adapter points the unchanged renderer at a localhost synthetic image fixture; those tests do not claim to load real external card artwork. The native placeholder SVG itself is tested unchanged. CSP and browser routes block all external traffic. No public-image downloads, proxies or private photographs are used.

Local syntax, preservation verification and **163 unit/reference checks pass**; **98 desktop/mobile checks** are prepared. Hosted screenshots and independent source review are required before merge. Service workers are blocked in browser QA; physical cameras, Safari and offline/PWA lifecycle are not covered. Existing disposable PostgreSQL/PostgREST compatibility remains a test-only regression, not production access. The workflow is exact-branch gated, contents-read only, pinned official actions/Playwright, bounded runtime and seven-day artifact retention, with no deployment or live database step.

The user's latest instruction narrows the already approved artwork fix to this self-contained placeholder. Publication/deployment is conditional on final review and exact-head green QA. Previous live SHA above is the code rollback reference, not a data rollback; never replay earlier inventory or deck batches.
