# OddsJunction — Deploy Runbook

## 0. Before anything else: rotate the API key

The key `09d8ff2b...` was shared in plaintext during development and must be
treated as compromised. Go to the-odds-api.com, revoke it, generate a new one.
Never put the new one in code — it goes in the k8s Secret only (step 3).

## 1. What changed from the original code

- **Odds fetching moved from in-process node-cron to a k8s CronJob.**
  `server.js` no longer requires `scheduler.js` at all - `scheduler.js` has
  been deleted from the app entirely. The web Deployment now only serves
  data; `k8s/cronjob.yaml` runs `node cronFetch.js` on its own schedule as a
  short-lived Job, completely decoupled from the web pod's lifecycle.
  Restarting/redeploying the web pod no longer risks missing a fetch window.
- **Cron schedule changed to 2x/day** (`0 */12 * * *`, i.e. 00:00 and 12:00
  UTC) to fit the-odds-api's 500 requests/month free tier:
  `7 sport keys x 2 runs/day x 30 days = 420 requests/month`, leaving
  headroom for manual test runs. The original 4x/day schedule
  (`0 */6 * * *`) would have used ~3,360/month - 6.7x over budget.
- **Same Docker image serves both roles.** The Deployment runs `node
  server.js` (default CMD in the Dockerfile); the CronJob overrides the
  command to `node cronFetch.js`. One image, two run modes - no second image
  to build or push.
- **Pod affinity removed.** It existed only because SQLite + a ReadWriteOnce
  PVC required the CronJob's pod to land on the same node as the web
  Deployment's pod. Now that both talk to CloudNativePG over the network
  (see section 3 below), neither has any storage-locality constraint.
- **Database migrated from SQLite-on-PVC to CloudNativePG.** `db.js` was
  rewritten to use the `pg` client instead of `sqlite3`. Every exported
  function (`insertOdds`, `scanAll`, `cleanupOldMatches`, etc.) keeps the
  exact same name/signature/return shape, so `server.js` and `cronFetch.js`
  needed zero changes for this. SQLite-specific date functions
  (`datetime('now', ?)`) were translated to Postgres equivalents
  (`now() - interval`). Columns intentionally stayed `TEXT` rather than
  `TIMESTAMPTZ` to preserve the exact same string-based behavior the rest
  of the app already expects.
- `cronFetch.js`: removed the hardcoded API key fallback. The app now hard-fails
  on startup if `ODDS_API_KEY` isn't set - this is intentional, not a bug.
- `cronFetch.js`: `SPORTS` array updated to match real, currently-active
  `sport_key` values confirmed against the-odds-api's `/sports` endpoint
  (which doesn't cost quota to call). The original keys `cricket`, `tennis`,
  and `soccer_aussie` don't exist on this API - they silently returned zero
  results rather than erroring, which is why those tabs looked "broken" but
  threw no errors.
- `server.js`: fixed the UFC tab filter - the-odds-api's real key for
  UFC/MMA is `mma_mixed_martial_arts`, which contains no `ufc` substring, so
  the original `.includes('ufc')` check could never match stored rows even
  though the data was being fetched correctly. Also fixed the tennis route,
  which filtered for `us_open_mens_singles` (a key with no current matches,
  US Open is in September) - now filters on `tennis`, matching any
  `tennis_*` tournament key currently active (Wimbledon right now).
- `db.js`: connects via `DATABASE_URL` (CNPG's auto-generated secret's `uri`
  field), or discrete `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`
  vars for local dev without a full CNPG cluster.
- `package.json`: removed `@aws-sdk/*`, `aws-sdk`, `playwright`, `rss-parser`,
  `node-cron` (k8s CronJob replaced it), and `sqlite3` (replaced by `pg`) -
  grepped the source files, none of the removed ones are referenced. The
  `readme.html` describes an old AWS-based architecture that no longer
  matches this app; AWS Elastic Beanstalk/DynamoDB/CloudFront are not part
  of this deployment.
- Betfair Exchange (`betfairExchange.js`) is kept as-is since you're using it -
  needs `BETFAIR_APP_KEY` / `BETFAIR_USERNAME` / `BETFAIR_PASSWORD` set. Its
  tennis filter (`_usOpenTennisAllowed`) intentionally remains US Open-only;
  it does not cover Wimbledon, by design, separate from the-odds-api fix above.
- Frontend (`index.html`, `style.css`) copied as-is into `public/`.

## 2. Local sanity check

Needs a Postgres instance reachable locally now (CNPG in k8s, or any local
Postgres for quick testing - e.g. `docker run -e POSTGRES_PASSWORD=devpass
-e POSTGRES_DB=oddsjunction -p 5432:5432 postgres:16`):

```bash
cp .env.example .env
# fill in ODDS_API_KEY, Betfair creds, and DATABASE_URL in .env
# e.g. DATABASE_URL=postgres://postgres:devpass@localhost:5432/oddsjunction
npm install
npm start          # serves on :3000, no cron runs here anymore
npm run cron       # runs one fetch cycle manually - this is what the
                   # k8s CronJob calls on its 12-hour schedule in production
```

## 3. Setting up CloudNativePG

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/cnpg-cluster.yaml
kubectl get cluster -n oddsjunction -w     # wait for status: Cluster in healthy state
```

This creates a single-instance Postgres cluster and an auto-generated Secret
`oddsjunction-pg-app` containing connection credentials (including a
ready-to-use `uri` field). `deployment.yaml` and `cronjob.yaml` both pull
`DATABASE_URL` from this secret's `uri` key via `secretKeyRef` - nothing to
configure manually here, CNPG and the app wire together automatically.

To bump this from 1 instance to 3 later (practicing CNPG's HA/failover
story), change `spec.instances` in `k8s/cnpg-cluster.yaml` - the operator
handles provisioning replicas and promoting a new primary on failure with
no other changes needed.

## 4. Secrets in GitOps — pick one

The cluster needs `oddsjunction-secrets` to exist in the `oddsjunction`
namespace before the Deployment will start cleanly. Two ways to do this with a
public or private GitLab repo without committing plaintext secrets:

**Option A — apply manually, don't commit it (simplest, fine for homelab):**
```bash
kubectl create namespace oddsjunction
kubectl create secret generic oddsjunction-secrets \
  --namespace oddsjunction \
  --from-literal=ODDS_API_KEY=your_real_key \
  --from-literal=BETFAIR_APP_KEY=your_key \
  --from-literal=BETFAIR_USERNAME=your_username \
  --from-literal=BETFAIR_PASSWORD=your_password
```
`k8s/secret.example.yaml` is a template only — never fill it in and commit it.

**Option B — sealed-secrets (lets the encrypted Secret live in git, ArgoCD-native):**
```bash
# once: install the sealed-secrets controller in-cluster, then:
kubectl create secret generic oddsjunction-secrets -n oddsjunction \
  --from-literal=ODDS_API_KEY=your_real_key --dry-run=client -o yaml | \
  kubeseal --format yaml > k8s/sealed-secret.yaml
git add k8s/sealed-secret.yaml   # this one IS safe to commit, it's encrypted
```

## 5. GitLab CI/CD setup

Nothing to configure manually — `CI_REGISTRY`, `CI_REGISTRY_IMAGE`,
`CI_REGISTRY_USER`, `CI_REGISTRY_PASSWORD` are auto-injected by GitLab for
the project running the pipeline. **This works identically against your
self-hosted GitLab instance** — these variables resolve to your own
in-cluster registry automatically, nothing here is hardcoded to gitlab.com.

Push to `main` → `.gitlab-ci.yml` builds with Kaniko (no privileged
Docker-in-Docker needed on your runner — relevant on bare-metal homelab
nodes where privileged containers are a real security smell) → pushes two
tags to your self-hosted registry:
- `<your-registry-host>/<group>/<project>:<commit-short-sha>` — immutable, use this in k8s
- `<your-registry-host>/<group>/<project>:latest` — convenience only, don't deploy off this

The one real external dependency: the Kaniko executor image itself is
pulled from `gcr.io` (Google's public registry) by your runner. If your
GitLab Runner pod has outbound internet access (likely, for a homelab
that's not airgapped), this just works. If it's fully airgapped, mirror
the Kaniko image into your own registry first and point the `image:` field
in `.gitlab-ci.yml` at that instead.

To find your actual in-cluster registry address for use in `image:` fields
below:
```bash
kubectl get svc -n gitlab | grep registry
```

## 6. Wiring up ArgoCD

```bash
# Edit k8s/deployment.yaml: set 'image:' to your registry address + tag
# Edit k8s/cronjob.yaml: set the SAME image + tag (must match deployment.yaml)
# Edit k8s/argocd-application.yaml: set 'repoURL' to your real GitLab repo URL
# Edit k8s/ingress.yaml: set the host to match your homelab DNS

kubectl apply -f k8s/argocd-application.yaml
```

ArgoCD will then watch `k8s/` in your repo and sync everything
(`namespace.yaml`, `cnpg-cluster.yaml`, `deployment.yaml`, `cronjob.yaml`,
`service.yaml`, `ingress.yaml`) automatically, with `prune: true` and
`selfHeal: true`. Apply `cnpg-cluster.yaml` once manually first, per section
3 above, before handing everything to ArgoCD, since the Cluster needs to
exist and be healthy before the app's first connection attempt.

## 7. Releasing a new version (manual tag bump, appropriate at this scale)

```bash
git push                                  # CI builds & pushes new image
# copy the new commit short-sha tag from the CI job log or registry UI
# edit BOTH k8s/deployment.yaml AND k8s/cronjob.yaml image: lines to the
# new tag - they must stay in sync, since both run the same image
git commit -am "deploy: bump image to <sha>"
git push                                  # ArgoCD selfHeal picks it up, redeploys
```

If you outgrow manual bumps later, **Argo CD Image Updater** can watch the
registry and auto-commit tag bumps to both files — not set up here since at
this call volume it's overkill for now, but worth knowing it exists.

## 8. Constraints to remember

- **Single Postgres instance, no HA yet.** `cnpg-cluster.yaml` runs
  `instances: 1` deliberately - no replication, no automatic failover.
  Fine for a hobby app's traffic; if the single Postgres pod goes down,
  the app has a real outage until it recovers (CNPG will restart it, but
  there's no standby to fail over to). Bump `instances: 3` if you want to
  practice CNPG's HA story specifically.
- **No backups configured.** `cnpg-cluster.yaml` doesn't set a `backup:`
  section. Data loss on PVC failure is possible. CNPG supports scheduled
  backups to S3-compatible storage (Barman Cloud) - worth adding once
  you've confirmed the basic setup works, not required to get started.
- **Watch your API quota.** 7 sport keys × 2 runs/day × 30 days ≈ 420
  requests/month against the 500/month free tier. If you add more sport
  keys to `SPORTS` in `cronFetch.js` later, redo this math before deploying
  — it's easy to blow through the quota by adding "just one more sport."
  `kubectl get cronjob -n oddsjunction` and `kubectl get jobs -n oddsjunction`
  show run history; Grafana/Prometheus (which you already run) could alert
  on Job failures via `kube-state-metrics` if you want this monitored
  properly rather than checked manually.
- The `/debug/*` routes in `server.js` have no auth. Fine behind a homelab
  ingress with no public exposure; if you ever expose this outside your LAN,
  add at least basic auth in the Ingress annotations first.

## 9. Where this is heading (not built yet, noted for context)

The plan discussed is to eventually stop using the-odds-api entirely and
instead run per-bookmaker scraper workloads in AWS EKS, which would push
clean parsed JSON into this same CloudNativePG cluster - making this a
genuine hybrid-cloud setup (compute in AWS, data plane in the homelab). The
hard part of that future phase is networking: this CNPG cluster is currently
only reachable inside the homelab's pod network, so EKS pods would need a
secure tunnel (WireGuard/Tailscale, most likely) to reach Postgres - punching
a hole in the home router for port 5432 is not recommended. None of this is
built yet; today's CNPG migration is deliberately compatible with it, since
whichever system writes the data (the-odds-api now, scrapers later), it
lands in the same schema either way.
