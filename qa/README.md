# Isolated synthetic browser QA — DRAFT, NEVER DEPLOY

This directory is a **test-only snapshot**, not release-ready production source. All 13 production files at the repository root remain byte-identical to main commit `9ae98e6f78a17f30aa7fc45ecb7ca38f1d644b25`. The workflow verifies those Git blob hashes before running tests. Do not copy this fixture over the live app or merge it as an application release.

## What is under review

`fixture/` is the canonical cloud QA development copy, including the independently reviewed safety corrections. It contains disabled Supabase placeholders, 120 synthetic catalog cards and a localhost-only synthetic seeding page. It includes **no user collection, saved login, private account identifier or working credential**. The original public repository files are preserved separately at the root; the test server never serves that root.

The development logic exercises local safety/manual sync, optional additive physical-card purchases (`2 + 4 = 6`), filtered valuation, strict restore and missing-price handling. Household files describe a **future proposal and executable reference model only**; they do not implement, migrate or test production database security. Read `fixture/REVIEW.md`, `fixture/QA-START.md` and `fixture/HOUSEHOLD-PROPOSAL.md` for the detailed scope and limitations. Their pre-GitHub publication statements describe the earlier development handoff, not the status of this newly authorized QA branch.

A future production patch must separately extract/review the actual application changes. Synthetic cards, disabled credentials, `qa-seed.html`, test setup and proposal SQL must **never** replace live files. No production migration, access grant, merge, deployment or public website preview is part of this PR.

## Execution and isolation

- The draft PR workflow runs only for this newly generated QA head branch, on pull-request events targeting `main`.
- It uses one standard GitHub-hosted Ubuntu runner, a 15-minute job limit, one Playwright worker, exact dependency versions and official actions pinned to commit SHAs.
- Workflow permissions are only `contents: read`; checkout credentials are not persisted. It references no secrets, deployments or Pages environment and has no publish/deploy step.
- The HTTP server binds **127.0.0.1 only**, serves **fixture only**, and sends a restrictive CSP denying external connections. Only local WebAssembly compilation is allowed for the bundled OCR initialization; JavaScript `unsafe-eval` is not enabled. Browser context routing also aborts external requests. The app's development-origin guard and nonfunctional cloud placeholders remain intact.
- Artifacts contain synthetic reports/screenshots/traces only and expire after 7 days. No real credentials are requested or entered.
- Service workers are blocked so request interception cannot be bypassed. **This is not offline/PWA/service-worker lifecycle coverage.** No physical phone, camera/OCR, real Supabase or household RLS/RPC pass is claimed.

## Deployment-trigger preflight (2026-10-25 UTC)

The authenticated owner is `Raestin`; the repository is public. Before creating the unique QA branch, the supported GitHub APIs showed only `main`, no `.github/workflows` files, and four historical built-in Pages deployments, all from `main`. The connector does **not** support the Pages configuration endpoint, so a direct configuration read was unavailable—not a successful read or a permission grant.

Branch isolation instead follows GitHub's documented Pages contract: a publishing branch must already exist before being selected, and branch-based publishing happens on changes to that selected branch. A new randomly named branch cannot be a preconfigured existing source. This QA PR changes no existing production file or `main` ref. The sole added workflow cannot deploy: it grants no Pages/id-token write permissions and contains no deployment action. No settings are changed.

Sources: [Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Pages workflow permissions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [official Playwright CI guide](https://playwright.dev/docs/ci).

## Run locally in an isolated cloud/test environment

```sh
cd qa
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:unit
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

Do not use an owner's live browser profile or origin. Test setup initializes synthetic browser state and must be used only in disposable test contexts. Actual CI results are reported in the PR and its workflow artifacts; this README does not imply unexecuted checks passed.
