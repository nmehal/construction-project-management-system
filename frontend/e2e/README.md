# Stage7C real-browser E2E

Fictional demo data only. This suite uses a real Chromium browser, the existing
frontend/API and its existing database: no mocks, API seeding, database resets,
containers, or server startup. Run only against a disposable/local demo workspace,
never production or a client workspace. The account must already exist as an
**Admin or Project Manager** (new project creators receive Manager membership).
No registration or role changes are performed.

## Run from the host

Use the supported Node version in `package.json` and the already-running stack.
From the repository root, in Bash:

```bash
cd frontend
npm ci
npx playwright install chromium
# On Linux, if Chromium reports missing libraries, have the operator install
# them with: npx playwright install-deps chromium
export E2E_BASE_URL=http://127.0.0.1:8080
read -r -p 'Demo account email: ' E2E_EMAIL
read -r -s -p 'Demo account password: ' E2E_PASSWORD; printf '\n'
export E2E_EMAIL E2E_PASSWORD
npm run test:e2e
# Interactive browser alternative: npm run test:e2e:headed
unset E2E_EMAIL E2E_PASSWORD
```

`E2E_BASE_URL` defaults to `http://127.0.0.1:8080`; override it with an origin
reachable from the runner (for example `http://host.docker.internal:8080` in a
sandbox). The same origin must serve both the SPA and API and support refresh
cookies. HTTP requires the existing local stack's non-secure cookie setting.
Do not change databases or Compose to accommodate the test runner.
`env.example` lists keys only and is not loaded automatically; no existing `.env`
file is read or changed. Credentials are environment-only. Missing credentials
fail global setup before browser launch, not a misleading skipped/pass result.

Collection without credentials or a running server:

```bash
npm run test:e2e -- --list
npm test -- --run
npm run build
```

`--list` validates discovery/configuration only, **not** live behavior. There is
one Chromium workflow, one worker and no retries, to avoid duplicate real writes.
The unit `test` script is unchanged; Vitest excludes `e2e/**`.

## Assertions and data lifecycle

The workflow signs in via labelled controls; creates `E2E Project <UUID>` with
contract A$500,000.00; adds an Approved variation (A$10,000.00 cost + A$1,500.00
margin = A$11,500.00, revised contract A$511,500.00); adds a subcontractor
(A$25,000.00 allowance, A$20,000.00 committed, A$5,000.00 paid, A$15,000.00
outstanding); creates a Draft A$50,000.00 claim, saves its edit to A$55,000.00,
then marks it Paid while leaving paid date blank. It inspects the actual PATCH
payload to prove no paid_date was sent, checks the server-generated timestamp,
and reads it back after direct nested navigation and reload. Successful refresh
responses and protected content verify in-memory session restoration from cookies.
Dashboard checks cover status counts, Draft exclusion from claims total, paid
total A$55,000.00 and outstanding A$0.00 (Issued + Overdue only). Logout is checked
against the real response and a subsequent protected document navigation.

**Records are deliberately left for inspection, even on failure.** Every run has
a UUID suffix; child records are also E2E-prefixed. This suite never deletes or
archives any records. After review, an operator may open only that exact
`E2E Project <UUID>` and use **Archive project → Confirm archive**. Check its
name/UUID before confirming. Archiving hides it from the default project list;
it does not delete children. Never bulk-clean by prefix or touch unrelated data.
Partial runs may leave an incomplete project. Re-running creates a new UUID.

## Privacy and limitations

Trace, screenshots and video are disabled for the whole workflow, and Playwright's
copy-prompt page snapshot is disabled with `PLAYWRIGHT_NO_COPY_PROMPT`. No storage
state or token files are written, no auth response bodies are inspected/logged,
and sign-in errors suppress fill arguments. Do not enable tracing, API debug logs,
UI recording or verbose environment dumps with real credentials. Generated report
and result directories are ignored. Keep any local diagnostic artifacts private.
A green unit/build/collection check does not establish E2E success: the live run
must finish with **1 passed**. If reachability, credentials, or Chromium libraries
block it, report that explicitly; do not infer that the host stack is down.
