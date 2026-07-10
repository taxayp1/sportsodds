# SportsOdds

### Australian Sports Betting Odds Comparison Platform

> Live odds comparison across major Australian bookmakers for AFL, NRL, Cricket, Tennis, UFC, and Racing — plus Betfair Exchange back/lay markets — deployed on a self-hosted Kubernetes homelab with a full GitOps CI/CD pipeline and in-pipeline image security scanning.

**[sportsodds.taxayp.com](https://sportsodds.taxayp.com)**

---

## What It Does

SportsOdds fetches and compares betting odds from Australian bookmakers in real time, helping users quickly identify the best available price across multiple platforms without visiting each site individually.

- Compares fixed odds across 21 AU bookmakers (Sportsbet, TAB, Neds, Ladbrokes, Betfair, Betr, BetRight, PlayUp, PointsBet, Unibet, Dabble, TABtouch, and more)
- Highlights the best available price per match / per runner, with best price flagged green
- Covers AFL, NRL, Cricket (T20 + Test), Tennis, UFC/MMA, and Racing (Horse, Harness, Greyhound)
- **Betfair Exchange tab** with per-sport filtering and live back/lay prices + liquidity across every supported sport, including multi-runner racing markets
- **Racing tab** with a best-odds board sourced from a free racing odds API, filtered to AU-domestic meetings
- Fixed-odds data refreshed on a schedule via Kubernetes CronJobs; racing refreshed every 5 minutes during racing hours
- Live match detection with countdown timers, dark/light theme, and a responsive mobile UI

---

## Infrastructure & Deployment

This repository contains the application code. The infrastructure is managed separately via GitOps:

**GitOps Repository:** [K8s-HomeLab-Gitops](https://github.com/taxayp1/K8s-HomeLab-Gitops)

### CI/CD Pipeline

Every push to `main` triggers a fully automated pipeline with zero manual steps:

```text
git push (VS Code)
      │
      ▼
GitLab CI Pipeline
      │
      ├── Stage 1: build-image
      │     Kaniko builds Docker image (rootless, no Docker-in-Docker)
      │     Pushes SHA-tagged image to self-hosted GitLab Container Registry
      │     registry.taxayp.com/taxayp/sportsodds:<commit-sha>
      │
      ├── Stage 2: security (Trivy)
      │     Scans the freshly-built image for OS + dependency CVEs
      │     Fails the pipeline on fixable CRITICAL vulnerabilities
      │     Blocks deploy of a vulnerable image before it reaches ArgoCD
      │
      └── Stage 3: update-manifests
            Auto-commits updated image tag to GitOps repo
            ArgoCD detects the change
            Rolls out new version to Kubernetes cluster
            Zero manual kubectl commands needed
```

### Kubernetes Deployment

The app runs on a 6-node bare-metal Kubernetes homelab:

| Component | Implementation |
|---|---|
| Web server | Kubernetes Deployment (1 replica) |
| Fixed-odds fetching | Kubernetes CronJob |
| Racing odds fetching | Kubernetes CronJob (every 5 min, 06:00–23:00 Australia/Brisbane) |
| Database | CloudNativePG (PostgreSQL operator) with S3 backups |
| Secrets | HashiCorp Vault + External Secrets Operator |
| Image builds | Kaniko via self-hosted GitLab CI |
| Image scanning | Trivy (CVE gate in CI, fails on fixable CRITICAL) |
| Registry | Self-hosted GitLab Container Registry |
| GitOps | ArgoCD (automated sync + selfHeal) |
| Public access | Cloudflare Tunnel (no port forwarding, home IP hidden) |
| TLS | cert-manager with Cloudflare DNS-01 |
| Monitoring | Prometheus + Grafana + Loki |

---

## Tech Stack

**Backend:** Node.js · Express · PostgreSQL (via `pg` client)

**Data sources:** Betfair Exchange API (back/lay markets) · public racing odds API · fixed-odds bookmaker data

**Infrastructure:** Kubernetes · ArgoCD · GitLab CI · Kaniko · Trivy · CloudNativePG · HashiCorp Vault · External Secrets Operator · Longhorn · Cilium · MetalLB · ingress-nginx · Cloudflare Tunnel

---

## Architecture

```text
                        Public Users
                             │
                    Cloudflare Tunnel
                  (no port forwarding)
                             │
                    ingress-nginx (k8s)
                             │
                    ┌────────┴────────┐
                    │                 │
             Web Server          CronJobs
           (Deployment)      (odds + racing fetch)
                    │                 │
                    └────────┬────────┘
                             │
                    CloudNativePG
                    (PostgreSQL)
                             │
                        S3 Backups
                        (AWS S3)

Secrets flow:
HashiCorp Vault → External Secrets Operator → k8s Secrets → pods
```

---

## Disclaimer

> **⚠️ Learning Project** — SportsOdds is a personal homelab and DevOps learning project demonstrating cloud-native infrastructure, CI/CD pipelines, and GitOps practices. It is not a commercial product.
>
> Odds displayed are for informational purposes only. Always verify with the bookmaker before placing any bet. We are not a betting operator and do not accept wagers.

---

## Related

- **Infrastructure repo:** [K8s-HomeLab-Gitops](https://github.com/taxayp1/K8s-HomeLab-Gitops)
- **Proxmox/Terraform infra:** [Proxmox-Terraform-Infra-For-K8s](https://github.com/taxayp1/Proxmox-Terraform-Infra-For-K8s)