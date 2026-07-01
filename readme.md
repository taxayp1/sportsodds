VS Code (Windows)
    ↓ git push
gitlab.taxayp.com/taxayp/oddsjunction
    ↓ .gitlab-ci.yml triggers
GitLab Runner (Kaniko) builds Docker image
    ↓ pushes to
registry.taxayp.com/taxayp/oddsjunction:SHA
    ↓ update image tag in
gitlab.taxayp.com/taxayp/K8s-HomeLab-Gitops
    ↓ ArgoCD detects change
Deploys to oddsjunction namespace
    ↓ running at
oddsjunction.taxayp.com
    ↓ data from
CloudNativePG (oddsjunction-pg)
    ↓ populated by
k8s CronJob every 12 hours
    ↓ secrets from
Vault via External Secrets Operator