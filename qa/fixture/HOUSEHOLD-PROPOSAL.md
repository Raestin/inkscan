# Household collection: review proposal, not deployed

Owner A and Owner B want ONE household collection, distinct sign-ins, no shared password. The current database's `user_id` rows and own-row policies cannot accomplish this just by installing the website on a second phone.

No accounts, invitations, grants, policies, production migrations, data imports or deployments were performed. `household-schema.proposal.sql` is deliberately guarded against execution. Existing production rows remain untouched. The current legacy adapter in app.js is for compatibility/testing against the existing per-user contract, NOT a claim that household sync is implemented. Household rollout is blocked until the server protocol below is implemented and security/migration review is approved. The reusable safety.js state, valuation, import and merge logic is independent of that adapter.

## Proposed storage and access

- One `households` record and explicit `household_members` rows linked to separate existing Supabase Auth identities. Initially only the verified existing owner is a member; adding Owner B is a separately reviewed access step after her own sign-in.
- One canonical household inventory keyed by `(household_id, printing_id, finish)`, nonnegative integer quantities, row revision and updated time. Preserve original Lorcast printing IDs and exact normal/foil quantities, including catalog-unresolved IDs.
- Per-device durable operations have random operation IDs. Server records a unique `(household_id, operation_id)` receipt plus payload digest. Same ID/same payload returns the prior receipt; same ID/different payload is rejected. Intentional second purchase uses a fresh ID, even for identical contents.
- Scans and confirmed purchases are positive deltas. They commute: two phones adding 1 each increases household quantity by 2. A transaction checks active membership from `auth.uid()`, locks affected rows, applies each operation exactly once and records receipts atomically. Never trust an actor/user ID supplied by a client.
- Absolute edits, reductions and deletes require the previously read row revision. Stale revisions abort the transaction and return both values for review. No automatic deduction, per-person duplicate collections, merging whole snapshot totals, or forced overwrite. Deletions remain recoverable tombstones.
- `household_snapshot` returns server-owned revision/cursor, inventory, deck metadata and receipts. `household_apply_operations` accepts the intended scope and queued operations, checks membership and returns acknowledged IDs with authoritative quantities/revisions. API must reject reused IDs with different payloads, unauthorized scope and negative/overflow quantities. Read and acknowledgement boundaries need database transactions; client code alone is insufficient.
- Store deck author metadata now but do not decide private/shared deck visibility by inference. Before deck access policies are finalized, obtain the owner's choice. Preserve unrecognized imported source lines and stable card identity mappings in the new deck schema.
- Enable RLS on every new table; membership-derived SELECT checks; writes only through narrow reviewed RPC(s). No service key or model key in the browser. Restrict execution/grants intentionally and test anonymous, nonmember, member, removed-member and cross-household cases. Exact SQL function privileges/search_path and policy recursion must be reviewed before use.

## Non-destructive migration and reconciliation

1. Preserve phone JSON/CSV and a cloud snapshot; compare exact IDs/normal/foil counts first. Known cloud checkpoint was the previously verified production collection counts; do not treat it as frozen if Owner A scans more.
2. Stage the existing owner rows into one household with an immutable legacy mapping. Use `INSERT ... SELECT` with a unique source mapping so retry cannot seed the same legacy row twice. Do NOT copy the collection once per person, sum phone and cloud snapshots as new purchases, or delete/rewrite legacy tables.
3. Verify per-printing/finish equality and aggregate counts, unresolved IDs and source decks. Block on mismatches. Import only truly pending phone operations once; existing snapshots are baselines, not additive purchase events.
4. Roll out a versioned adapter after server approval. Prevent old automatic-sync clients from writing the legacy store while new clients write the household store. Plan a controlled cutover and read-only rollback checkpoint; no ongoing bidirectional mirror.
5. Invite/add Owner B only after membership/access approval. Both phones and desktop read the same household snapshot. Pending offline operations remain local until manual Update; outbox removal requires a durable confirmed server receipt.

## Manual-only behavior and failure rules

Editing/scanning/importing changes the local durable copy and increases pending counts. Update fetches a fresh snapshot, previews intended changes, and requires explicit confirmation. It does not run on startup, focus, reconnect, timers or sign-in. Cancellation makes no cloud writes. If network results are uncertain, preserve the outbox and retry identical operation IDs; never generate fresh IDs merely to retry. Report partial/uncertain outcomes accurately. Keep a server-confirmed sync timestamp distinct from local save time.

## Scope boundary

Household membership plus transactional operation RPCs are a material expansion beyond the initial client-only safety patch. They are needed for reliable simultaneous scanning on two phones. Current legacy guarded PATCH/INSERT and conflict abort improve the old single-owner workflow but cannot make a multi-table update atomic or provide exactly-once additive household operations. The development origin guard blocks real cloud access on localhost/cloud QA previews. Tests use synthetic fixtures/mocks only. Production publication and all access changes remain pending explicit review.
