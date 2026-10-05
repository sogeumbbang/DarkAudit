# DarkAudit Frontend

## Local development

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

`VITE_USE_MOCKS=true` keeps all API calls in the browser through MSW. To use FastAPI, set
`VITE_USE_MOCKS=false` and configure `VITE_API_BASE_URL`.

## Backend contract

The frontend currently calls:

- `GET /api/v1/dashboard/summary`
- `POST /api/v1/audits`
- `POST /api/v1/audits/{auditId}/screens` (`multipart/form-data`)
- `POST /api/v1/audits/{auditId}/analyze`
- `GET /api/v1/analysis-jobs/{jobId}`
- `PATCH /api/v1/findings/{findingId}`

The first private API request creates a browser workspace through `POST /api/v1/sessions`.
Its opaque bearer token is stored in localStorage, scoped to the configured API URL; cookies
are not used. Reloads and later visits in the same browser retain access. Clearing browser
storage removes that access key; a newly created workspace cannot access the old records.
This is browser workspace isolation, not an account login or cross-device identity system.
Upload requests use a two-minute timeout; other requests use 30 seconds.

Audit image responses contain signatures scoped to one image and expiring at the next UTC
midnight. Database files, APK uploads and manifests are never served through `/artifacts`.
Reopen the audit to renew image links. The `?job=...` address reconnects to a persisted job;
the audit list also links to its latest job. Interrupted jobs retain their collected history.

After FastAPI is running on port 8000, regenerate its TypeScript contract with:

```powershell
npm run api:types
```

## Quality checks

```powershell
npm run build
npm run lint
npm run test
npx playwright install chromium
npm run test:e2e
```

Browser tests use Playwright's pinned Chrome for Testing (`channel: "chromium"`), so local and
CI runs use the same browser revision from `package-lock.json`. The `desktop-chrome` and
`mobile-chrome` project names are retained for existing snapshot paths. Reinstall Chromium
after updating Playwright. CI retains its HTML report, screenshots and traces for seven days.
The frontend runner is pinned to Ubuntu 24.04. Browser tests disable LCD text antialiasing
to avoid host-dependent RGB fringes on glyph edges while keeping pixel comparisons strict.

Visual snapshots cover 1440px desktop and 412px mobile viewports. Run `npm run
test:e2e:update` only after intentionally reviewing a UI change. Lighthouse expects a production
preview on port 4173 and writes its report to `reports/lighthouse.json`.
