# Required Secrets & Variables

This file documents every secret and environment variable that must be configured
in GitHub before the workflows in this repository can run. **No secret values are
committed to this file or anywhere else in the repository.**

---

## GitHub Environments

Create two GitHub Environments in this repository's settings:

| Environment   | Required reviewers | Purpose                                |
|---------------|--------------------|----------------------------------------|
| `staging`     | (optional)         | Automatic deploys on push to `main`    |
| `production`  | Yes (≥1 reviewer)  | Manual/gated deploys                   |

---

## Secrets (per environment)

Configure these under **Settings → Environments → \<env\> → Secrets**.

### Azure OIDC Credentials

These replace a long-lived `AZURE_CREDENTIALS` JSON blob. Using OIDC avoids
storing any client secret.

| Secret name              | Description                                                            |
|--------------------------|------------------------------------------------------------------------|
| `AZURE_CLIENT_ID`        | Client ID of the Azure AD app registration / managed identity         |
| `AZURE_TENANT_ID`        | Azure AD tenant ID                                                     |
| `AZURE_SUBSCRIPTION_ID`  | Azure subscription ID to deploy into                                   |

> **How to set up OIDC:**
> 1. Create an App Registration (or use an existing one).
> 2. Add a Federated Credential → GitHub Actions → repo `Tannrow/vehr-infra`,
>    subject `environment:staging` (or `environment:production`).
> 3. Assign the app `Contributor` (or a custom least-privilege role) on the
>    target resource group.
> 4. Paste the client ID, tenant ID, and subscription ID as secrets above.

---

## Variables (per environment)

Configure these under **Settings → Environments → \<env\> → Variables**.
Variables are not sensitive; they are visible in workflow logs.

| Variable name                  | Example value                          | Description                            |
|--------------------------------|----------------------------------------|----------------------------------------|
| `AZURE_RESOURCE_GROUP_STAGING` | `vehr-revos-staging-rg`                | Resource group for staging deployments |
| `ACR_LOGIN_SERVER_STAGING`     | `vehrrevostagingacr.azurecr.io`        | ACR login server URL (staging)         |
| `KEY_VAULT_NAME_STAGING`       | `vehr-kv-staging`                      | Optional Key Vault name for staging backend secrets; leave unset to skip Key Vault-backed secret wiring during plan/bootstrap |
| `MANAGED_IDENTITY_RESOURCE_ID_STAGING` | `/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<name>` | Optional managed identity resource ID for staging app ACR pulls and backend secrets; when unset the workflows now try to discover it from the deployed backend app or the first identity in the staging resource group |
| `UI_APP_NAME_STAGING`          | `vehr-revenue-ui-staging-eus2`         | Container App name for the UI          |
| `BACKEND_APP_NAME_STAGING`     | `vehr-revos-staging-eus2`              | Container App name for the backend     |

For production, duplicate the above with `_PRODUCTION` suffixes (update the
`apply-production` workflow when you create it).

If the two staging variables above are left unset, the staging Bicep parameters
omit the backend Key Vault secret and managed identity wiring. That keeps
planning/bootstrap workflows working, but a backend deployment that needs a
database connection should set both variables.

The staging workflows now also try to resolve missing
`KEY_VAULT_NAME_STAGING` / `MANAGED_IDENTITY_RESOURCE_ID_STAGING` from the
deployed backend Container App first, and then fall back to the first Key Vault
or user-assigned identity in the staging resource group. That keeps plan,
apply, and rollback resilient even when the GitHub environment variables are
not populated yet.

---

## Repository Variables (not environment-scoped)

| Variable name   | Example value   | Description                     |
|-----------------|-----------------|---------------------------------|
| *(none yet)*    |                 | Add cross-environment vars here |

---

## Secrets needed in app repos

The `revenue-ui` and `VEHR` repos need their own secrets to push images to ACR
and trigger deployments here.

### revenue-ui / VEHR (each)

| Secret / Variable                  | Description                                                                 |
|------------------------------------|-----------------------------------------------------------------------------|
| `AZURE_CLIENT_ID`                  | Same OIDC app registration (or a separate one with `AcrPush` + no broader scope) |
| `AZURE_TENANT_ID`                  | Same tenant                                                                 |
| `AZURE_SUBSCRIPTION_ID`            | Same subscription                                                           |
| `ACR_LOGIN_SERVER`                 | e.g. `vehrrevostagingacr.azurecr.io`                                       |
| `INFRA_REPO_PAT` *(optional)*      | A fine-grained PAT with `workflow` scope on `vehr-infra`, used to trigger `repository_dispatch` and invoke the apply-staging workflow after a push |

---

## Key Vault Secrets

Sensitive runtime config (database connection strings, API keys, etc.) must be
stored in Azure Key Vault, **not** in GitHub secrets or Bicep parameter files.
Reference them via the `secrets` array in the Bicep parameter files, using a
managed identity for access.

| Key Vault Secret name       | Description                       | Referenced by        |
|-----------------------------|-----------------------------------|----------------------|
| `db-connection-string`      | SQL/Postgres connection string    | Backend Container App |
| *(add more as needed)*      |                                   |                      |

---

## Least-privilege checklist

- [ ] OIDC app registration has only `Contributor` on the resource group (not subscription)
- [ ] ACR push identity has only `AcrPush` role on the registry
- [ ] Managed identity has only `Key Vault Secrets User` on the specific vault
- [ ] No `Owner` or `User Access Administrator` granted unless specifically required
- [ ] All secrets rotated on a regular schedule
