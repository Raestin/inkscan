# Production candidate validation

This hidden CI directory is not the production app and is not linked by it. The root contains the real catalog and existing production configuration. Do not publish `.github/qa/fixture` or substitute synthetic files into root.

`verify-release.cjs` checks immutable SHA-1 catalog/asset blobs, SHA-256 hashes of the original production configuration statements (without printing their values), v6 script order/cache entries, absence of forced worker takeover, and preservation of legacy storage keys. Rollback reference: `9ae98e6f78a17f30aa7fc45ecb7ca38f1d644b25`.

`prepare-fixture.cjs` constructs a disposable localhost test copy from **this release's root runtime**, not the earlier QA app. Only cloud constants and catalog are replaced, plus synthetic seeding/test files added. Normalized app source equality is asserted. No collection, login or real account data is read. Tests run 59 synthetic unit/reference-model checks and 22 Chromium checks (11 scenarios on desktop/mobile viewports), including a zero-owned smoke test using the unchanged public 3,469-printing catalog with all external requests blocked.

Five unit checks are the existing household protocol reference model only. They do not ship a household feature, schema, RPC, RLS, invitation or access change. No SQL is present in this release. Live cloud writes and authentication, physical phone/camera recognition, Safari and offline/service-worker lifecycle are not tested here. The browser suite blocks service workers, external traffic and cloud requests; the local server CSP permits bundled local WebAssembly but not JavaScript unsafe-eval.

Runtime improvements: validated atomic local state, retained unresolved IDs, manual preview/confirm cloud updates, partial-failure receipts/conflict abort, optional additive physical purchases, filtered normal/foil valuation, cancelable strict restore, missing-price finish handling, and persistent in-dialog save warnings. Legacy single-owner sync is not a transactional multi-phone household system.

The PR must pass CI and independent source review before the authorized production merge. Pages deployment occurs only after main is updated, not from this PR validation workflow. Rollback is a separately authorized Git revert to the preserved baseline; do not force-push or delete collections. Existing legacy keys remain intact, and unknown IDs are retained.
