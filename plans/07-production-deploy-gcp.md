# Plan 07 — Production packaging & deploy to GCP (`sandycoast.smalldat.com`)

Status: **CONFIGURED — awaiting one-time GCP/DNS setup** (see §5)
Target URL: `https://sandycoast.smalldat.com`
GCP project: `smalldat` (billing enabled, deploy stays in free tier)

> This deploys the **playground demo site**, not the `@smalldat/visual` npm
> library. The library ships via `npm run build` (tsup → `dist/`); the demo ships
> via `npm run build:site` (Vite → `site-dist/`). Two separate artifacts, one repo.

---

## 1. What ships

The Vite playground (`playground/`) is a self-contained static site: one
`index.html` + one JS bundle (~80 kB, ~20 kB gzip) that imports the library
source from `src/`. No server, no API, no database. Pure static hosting.

Build command:

```powershell
npm run build:site       # vite build -> site-dist/
npm run preview:site     # serve site-dist/ locally to verify before deploy
```

Output: `site-dist/{index.html, assets/*}`. Git-ignored; rebuilt in CI.

## 2. Hosting choice — Firebase Hosting (free)

| Option | Free tier | Custom domain + SSL | Fit |
| --- | --- | --- | --- |
| **Firebase Hosting** | Spark plan, 10 GB storage / 360 MB-day transfer | Auto-provisioned SSL, one-click domain | **Chosen** — simplest, genuinely free, native to GCP project |
| Cloud Run (static container) | 2M req/mo | Domain mapping, needs container | Overkill for static |
| GCS bucket + HTTPS LB | Bucket free-ish | LB is **not** free (~$18/mo) | Rejected — costs money |

Firebase projects *are* GCP projects — enabling Firebase on `smalldat` adds
Hosting without a second project. The billing account stays attached; static
hosting at this volume incurs $0.

Config: [`firebase.json`](../firebase.json) (public dir `site-dist`, long-cache
immutable assets, no-cache `index.html`) and [`.firebaserc`](../.firebaserc)
(default project `smalldat`).

**Dedicated Hosting site `sandycoast`** (`sandycoast.web.app`). The project's
default site `smalldat.web.app` is reserved for other content and is **not**
touched — `firebase.json` pins `"site": "sandycoast"` and the workflow deploys
`--only hosting:sandycoast`. Multiple Hosting sites live in one project for free.

## 3. CI/CD — GitHub Actions

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

Trigger: push to `main` (or manual `workflow_dispatch`). Steps:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build:site`
5. Authenticate to GCP via **Workload Identity Federation** (keyless)
6. `firebase deploy --only hosting --project smalldat`

`concurrency` serializes deploys and cancels superseded runs.

### Why keyless (WIF) over a service-account JSON key

No long-lived secret stored in GitHub. GitHub's OIDC token is exchanged for
short-lived GCP credentials scoped to this repo only. `firebase-tools` picks up
the credentials via `GOOGLE_APPLICATION_CREDENTIALS` (set by
`google-github-actions/auth`).

## 4. Required GitHub secrets

Set in repo → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `GCP_WIF_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_DEPLOY_SA` | `github-deployer@smalldat.iam.gserviceaccount.com` |

## 5. One-time setup (run once by an owner of `smalldat`)

Requires `gcloud` + `firebase` CLIs, authenticated as a project owner.

### 5a. Enable Firebase Hosting on the project

```powershell
firebase projects:addfirebase smalldat        # if not already a Firebase project
gcloud services enable firebasehosting.googleapis.com --project smalldat

# Dedicated Hosting site for this demo (default smalldat.web.app stays reserved):
firebase hosting:sites:create sandycoast --project smalldat
```

### 5b. Deploy service account

```powershell
gcloud iam service-accounts create github-deployer `
  --project smalldat --display-name "GitHub Actions Hosting deployer"

gcloud projects add-iam-policy-binding smalldat `
  --member "serviceAccount:github-deployer@smalldat.iam.gserviceaccount.com" `
  --role "roles/firebasehosting.admin"

# Needed so the CLI can resolve the project / list sites:
gcloud projects add-iam-policy-binding smalldat `
  --member "serviceAccount:github-deployer@smalldat.iam.gserviceaccount.com" `
  --role "roles/firebase.viewer"
```

### 5c. Workload Identity Federation (keyless GitHub → GCP)

```powershell
$ProjectNumber = gcloud projects describe smalldat --format='value(projectNumber)'

gcloud iam workload-identity-pools create github `
  --project smalldat --location global --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github `
  --project smalldat --location global --workload-identity-pool github `
  --display-name "GitHub OIDC" `
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" `
  --attribute-condition "assertion.repository=='ondrejspilka/sandycoast.smalldat'" `
  --issuer-uri "https://token.actions.githubusercontent.com"

# Let the GitHub repo impersonate the deploy SA:
gcloud iam service-accounts add-iam-policy-binding `
  github-deployer@smalldat.iam.gserviceaccount.com `
  --project smalldat --role roles/iam.workloadIdentityUser `
  --member "principalSet://iam.googleapis.com/projects/$ProjectNumber/locations/global/workloadIdentityPools/github/attribute.repository/ondrejspilka/sandycoast.smalldat"

Write-Host "GCP_WIF_PROVIDER = projects/$ProjectNumber/locations/global/workloadIdentityPools/github/providers/github"
```

Put the printed value into the `GCP_WIF_PROVIDER` secret (§4).

### 5d. Custom domain `sandycoast.smalldat.com`

In the Firebase console → Hosting → **Add custom domain** →
`sandycoast.smalldat.com`. Firebase gives an A record (and/or TXT for
verification). Add it at the `smalldat.com` DNS provider:

```
sandycoast   A     151.101.1.195   (+ the second A record Firebase lists)
```

Firebase auto-provisions a managed SSL cert once DNS resolves (minutes–hours).

## 6. First deploy

After §5, either push to `main` or run the workflow manually
(Actions → Deploy → Run workflow). Verify:

- `https://sandycoast.web.app` (dedicated site's Firebase URL) serves the demo
- `https://sandycoast.smalldat.com` serves it once DNS + cert are live

Custom domain (§5d) attaches to the **`sandycoast`** site, not the default.

## 7. Rollback

Firebase keeps every release. Roll back in the console (Hosting → release
history → Rollback) or `firebase hosting:rollback --project smalldat`.

## 8. Open items / future

- Preview channels per PR (`firebase hosting:channel:deploy pr-<n>`) — optional.
- If the demo later needs SSR/API, migrate to Cloud Run (still free tier).
