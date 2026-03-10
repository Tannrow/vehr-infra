# vehr-infra

Central infrastructure repository for the VEHR / Revenue-UI platform.
All Azure resources are managed as code here and deployed via GitHub Actions — no manual portal changes required.

---

## Control Tower

### Overview

`vehr-infra` is the **single source of truth** for all cloud infrastructure. It uses
[Azure Bicep](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/overview)
to declare resources and GitHub Actions to plan and apply changes.

```
Tannrow/revenue-ui  ──┐
                       ├─► build & push image ──► ACR ──► apply-staging (vehr-infra)
Tannrow/VEHR        ──┘
                                                              │
                                                  Azure Container Apps (staging / production)
```

### Repositories

| Repo | Role |
|------|------|
| `Tannrow/revenue-ui` | React/Vite frontend — owns Dockerfile, app code, and image push workflow |
| `Tannrow/VEHR` | .NET backend — owns Dockerfile, app code, and image push workflow |
| `Tannrow/vehr-infra` *(this repo)* | Infrastructure as code plus the VEHR Control Tower operations service |

### How to make changes

| Type of change | Where to make it | How it deploys |
|----------------|-----------------|----------------|
| App code (UI or backend) | In the respective app repo | App repo CI builds & pushes a new image, then triggers `apply-staging` here via `repository_dispatch` |
| Azure resource config (scaling, env vars, domains, secrets) | Edit `infra/parameters/staging.bicepparam` or `infra/parameters/production.bicepparam` in **this repo** | Open a PR → `plan-staging` runs What-If → merge → `apply-staging` deploys |
| New Azure resource | Add a module in `infra/modules/` and wire it into `infra/main.bicep` | Same as above |
| Emergency rollback | Run the **Rollback – Staging** workflow manually with the desired image tags | Workflow redeploys the specified tags |

> **Rule:** Never make infrastructure changes through the Azure portal. All drift
> will be overwritten on the next deployment.

### Environments

| GitHub Environment | Azure Resource Group | Protection |
|--------------------|-----------------------|-----------|
| `staging` | `rg-vehr-staging` | None (auto-deploys on push to `main`) |
| `production` | `rg-vehr-prod` | Required reviewer approval |

### Workflows

| Workflow | File | Trigger |
|----------|------|---------|
| **Plan – Staging** | `.github/workflows/plan-staging.yml` | PR touching `infra/**` |
| **Apply – Staging** | `.github/workflows/apply-staging.yml` | Push to `main` touching `infra/**`, manual dispatch, or `repository_dispatch` from app repos |
| **Rollback – Staging** | `.github/workflows/rollback-staging.yml` | Manual (`workflow_dispatch`) |

### Secrets & Variables

See [`docs/SECRETS.md`](docs/SECRETS.md) for a complete list of GitHub secrets,
environment variables, and Key Vault secrets that must be configured before the
workflows will run.

### Directory Structure

```
vehr-infra/
├── .github/
│   └── workflows/
│       ├── plan-staging.yml       # What-If diff on PRs
│       ├── apply-staging.yml      # Deploy to staging
│       └── rollback-staging.yml   # Revert staging to a previous image tag
├── infra/
│   ├── main.bicep                 # Root template (wires all modules together)
│   ├── modules/
│   │   ├── container-registry.bicep    # Azure Container Registry
│   │   ├── container-apps-env.bicep    # Shared Container Apps Environment
│   │   └── container-app.bicep         # Generic Container App (UI, backend, Control Tower)
│   └── parameters/
│       ├── staging.bicepparam     # Staging-specific values
│       └── production.bicepparam  # Production-specific values
├── control-tower/
│   ├── src/                       # Control Tower API, diagnostics layer, event stream, and dashboard
│   ├── test/                      # Focused node:test coverage for the control plane
│   └── Dockerfile                 # Control Tower container image
└── docs/
    └── SECRETS.md                 # Required secrets & least-privilege guide
```

### Local development / manual deployment

```bash
# Preview changes without applying (staging)
az deployment group what-if \
  --resource-group rg-vehr-staging \
  --template-file infra/main.bicep \
  --parameters infra/parameters/staging.bicepparam

# Apply changes (staging)
az deployment group create \
  --resource-group rg-vehr-staging \
  --template-file infra/main.bicep \
  --parameters infra/parameters/staging.bicepparam \
  --mode Incremental
```

### Adding a new environment variable to the backend

1. Open `infra/parameters/staging.bicepparam`.
2. Add the variable to the `backendEnvVars` array:
   ```bicep
   { name: 'MY_NEW_VAR', value: 'my-value' }
   ```
   Or, for secrets stored in Key Vault:
   ```bicep
   { name: 'MY_SECRET_VAR', secretRef: 'my-secret-name' }
   ```
   And add the corresponding entry to `backendSecrets`.
3. Open a PR — `plan-staging` will show the diff.
4. Merge — `apply-staging` will deploy.

### VEHR Control Tower

The repo now contains a self-contained operations service in
[`control-tower/`](control-tower) that provides:

- canonical health records for services, workers, pipelines, infrastructure, incidents, alerts, commands, and deployments
- operator APIs under `/api/control/*`
- an SSE event stream at `/api/control/events/stream`
- a live operator dashboard at `/`
- a safe command bus with validation, dry-run support, audit logging, and pluggable execution hooks
- replaceable Azure/database/runtime adapters to support future AI-assisted operations

#### Local run

```bash
cd control-tower
npm test
npm start
```

#### Optional Azure deployment

Control Tower is wired into `infra/main.bicep`, but deployment is intentionally
**optional by default** so existing staging/prod applies do not fail before an
image is published. To deploy it:

1. Build and push a `control-tower` image to your registry.
2. Run **Apply – Staging** with `control_tower_image_tag`, or pass
   `controlTowerImage=<registry>/control-tower:<tag>` via Azure CLI.
3. After deployment, Control Tower auto-discovers the VEHR UI/backend FQDNs and
   exposes live platform health, deployment state, incidents, alerts, and safe
   recovery commands in one place.

### Adding a custom domain

1. Provision a certificate in the Container Apps Environment (via `az containerapp env certificate upload`).
2. Add the binding to `uiCustomDomains` or `backendCustomDomains` in the parameter file:
   ```bicep
   param uiCustomDomains = [
     {
       name: 'app.yourdomain.com'
       certificateId: '/subscriptions/.../certificates/my-cert'
     }
   ]
   ```
3. Open a PR, review the What-If output, and merge.

### Rollback procedure

1. Find the image tag you want to revert to (e.g. from the ACR tag list or a previous workflow run summary).
2. Go to **Actions → Rollback – Staging → Run workflow**.
3. Enter the UI and backend image tags.
4. Enter a brief reason (for the audit log).
5. Click **Run workflow** — the workflow will redeploy and run health checks automatically.
