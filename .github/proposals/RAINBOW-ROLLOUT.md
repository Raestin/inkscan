# Rainbow-finish bridge: reviewed staging proposal, NOT applied

Production project and owner are intentionally omitted from this public document. No user's collection, email, UUID, or backup belongs in this repository/CI.

## Scope
Add one independent `public.collection.rainbow_foil integer NOT NULL DEFAULT 0 CHECK (rainbow_foil >= 0)` column. Keep `q` (normal), `f` (existing generic foil), row IDs, ownership, timestamp trigger, grants and RLS unchanged. This is a limited Lorcana bridge, not household/multi-game support or universal finish classification.

The guarded `rainbow-column.sql` is a non-executable review proposal. Removing its exception guard is not authorization to execute it. Approval must separately cover the exact production schema change and release.

## Before production mutation
- Reverify project/owner and current schema, policy, trigger and primary-key metadata. Reject any unexpected pre-existing rainbow column or changed contract; do not hide it with IF NOT EXISTS.
- Obtain a fresh owner-scoped cloud snapshot and device JSON backup; ask the user to finish manual Update and briefly pause edits. Earlier snapshots/Update confirmations are not current freeze tokens.
- Preserve all row IDs, q/f counts, updated_at values, deck/wishlist values and unresolved IDs. Store private backups outside GitHub and public CI.
- Require green exact-head unit, desktop/mobile and real disposable PostgreSQL/PostgREST tests plus independent source/manifest review.

## Controlled order after explicit approval
1. In one bounded transaction, lock timeout5s/statement timeout30s, add only the column/check. Compare every original row's identity/q/f/updated_at against the fresh pre-change snapshot and verify all existing rainbow values are zero. Roll back on any mismatch. No grants, policies, auth accounts or functions change.
2. Verify Data API schema cache recognizes the field using the current authenticated owner's read-only zero-row select; request a schema-cache reload only if needed and authorized. Do not infer successful schema exposure from SQL success.
3. Publish the reviewed client. The client probes capability only inside explicit Update, never at boot/sign-in. If any rainbow state exists locally or in its baseline and the column is missing, the entire update stops before any cloud write. A q/f-only pre-migration client path is retained when the absence is confirmed, not on generic network/auth failures.
4. User closes older tabs/PWA windows and opens the new version. It reads/migrates v5 to a separate v6 local envelope, retains exact old keys, and fences later edits made by an older tab. It never forces service-worker takeover or clears saved data.
5. Perform a controlled signed-in round-trip only with separately authorized synthetic/test records or a clearly approved real operation; verify the phone sees q/f/rainbow separately before saying end-to-end production sync passed.
6. Only then resume the separately requested starter-card addition using a NEW fresh snapshot and all-or-nothing, immutable preconditions. No starter cards have been added by this proposal or CI.

## Backups and compatibility
New JSON backups use `app: inkscan-v6-backup`; old apps reject them. New CSV headers are versioned so old importers cannot silently treat rainbow as normal. New readers accept complete old JSON/CSV while retaining existing rainbow quantities and state this in the review. A full v6 restore shows all three finishes and explicit replacement counts. Legacy-change fencing requires deliberate reconciliation, not automatic baseline reset.

Known v4 upserts and v5 patches only send q/f; disposable PostgreSQL17.11/PostgREST16.5 tests exercise preservation of an omitted rainbow column, including q/f-zero tombstones, stale compare-and-set, negative quantities and owner isolation. This does NOT guarantee arbitrary old/custom DELETE, PUT or SQL operations are safe, nor prove every deployed PostgREST version.

## Rollback
Keep current released commit `6ef439a7a3ac59de0f273f484d4348b1800cd07d` and private pre-change backups. Once rainbow data exists, do not drop the column or restore an older whole database snapshot as a code rollback. Prefer leaving the additive column/data intact while reverting client code to read-only/manual recovery as needed. The older client cannot display/export rainbow correctly. A v6 local backup must not be force-imported into v5. Any data rollback or reclassification requires separate reviewed reconciliation.

## Price/catalog limits
No universal Holofoil=rainbow inference. Exact curated quotes bind printing identity, product, provider subtype, currency and dated source; mismatches, missing quotes or quotes older than7days remain unpriced. Generic foil quotes for products with multiple foil subtypes are suppressed. Existing generic foil inventory is not relabeled. Physical camera recognition and every rarity/treatment are not declared tested by synthetic UI checks.
