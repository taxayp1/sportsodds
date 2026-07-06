# SportsOdds

### Australian Sports Betting Odds Comparison Platform

> Live odds comparison across major Australian bookmakers for AFL, NRL, Cricket, Tennis, and UFC — deployed on a self-hosted Kubernetes homelab with a full GitOps CI/CD pipeline.

**[sportsodds.taxayp.com](https://sportsodds.taxayp.com)**

---

## What It Does

SportsOdds fetches and compares betting odds from Australian bookmakers in real time, helping users quickly identify the best available price across multiple platforms without visiting each site individually.

- Compares odds across 10+ AU bookmakers (Sportsbet, TAB, Neds, Ladbrokes, Betfair, Betr, BetRight, PlayUp, PointsBet, Unibet, and more)
- Highlights best available home and away price per match
- Covers AFL, NRL, Cricket (T20 + Test), Tennis, UFC/MMA, and Betfair Exchange
- Updates automatically twice daily via a Kubernetes CronJob
- Live match detection with countdown timers

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
      └── Stage 2: update-manifests
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
| Odds fetching | Kubernetes CronJob (runs 00:00 + 12:00 UTC) |
| Database | CloudNativePG (PostgreSQL operator) with S3 backups |
| Secrets | HashiCorp Vault + External Secrets Operator |
| Image builds | Kaniko via self-hosted GitLab CI |
| Registry | Self-hosted GitLab Container Registry |
| GitOps | ArgoCD (automated sync + selfHeal) |
| Public access | Cloudflare Tunnel (no port forwarding, home IP hidden) |
| TLS | cert-manager with Cloudflare DNS-01 |
| Monitoring | Prometheus + Grafana + Loki |

---

## Tech Stack

**Backend:** Node.js · Express · PostgreSQL (via `pg` client)

**Infrastructure:** Kubernetes · ArgoCD · GitLab CI · Kaniko · CloudNativePG · HashiCorp Vault · External Secrets Operator · Longhorn · Cilium · MetalLB · ingress-nginx · Cloudflare Tunnel

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
             Web Server          CronJob
           (Deployment)      (every 12 hours)
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