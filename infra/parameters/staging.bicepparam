// Staging environment parameters
// Reference: infra/main.bicep
// Deploy with:
//   az deployment group create \
//     --resource-group <rg-staging> \
//     --template-file infra/main.bicep \
//     --parameters infra/parameters/staging.bicepparam

using '../main.bicep'

param environment = 'staging'
param location = 'eastus'

// ── Container Registry ──────────────────────────────────────────────────────
// Reuse an existing registry name if one is already established in Azure.
param acrName = 'vehracrstaging'
param acrSku = 'Basic'

// ── Container Apps Environment ──────────────────────────────────────────────
param containerAppsEnvName = 'vehr-env-staging'

// ── App names ───────────────────────────────────────────────────────────────
param uiAppName = 'revenue-ui-staging'
param backendAppName = 'vehr-api-staging'

// ── Images — updated by the apply-staging workflow ─────────────────────────
// Format: <acrLoginServer>/<repo>:<tag>
param uiImage = 'vehracrstaging.azurecr.io/revenue-ui:latest'
param backendImage = 'vehracrstaging.azurecr.io/vehr:latest'

// ── Ports ───────────────────────────────────────────────────────────────────
param uiTargetPort = 80
param backendTargetPort = 8080

// ── Scaling ─────────────────────────────────────────────────────────────────
param uiMinReplicas = 0
param backendMinReplicas = 0

// ── Custom domains (leave empty until certs are provisioned) ─────────────
param uiCustomDomains = []
param backendCustomDomains = []

// ── Environment variables ───────────────────────────────────────────────────
// Plain values only here; secrets use secretRef pointing to the secrets array below.
param uiEnvVars = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'VITE_API_URL'
    // Replace with your Container Apps environment default domain from Azure Portal,
    // or with your custom domain once configured.
    // Format: https://<backend-app-name>.<env-unique-id>.<region>.azurecontainerapps.io
    value: 'https://vehr-api-staging.<REPLACE_WITH_ENV_DEFAULT_DOMAIN>'
  }
]

param backendEnvVars = [
  {
    name: 'ASPNETCORE_ENVIRONMENT'
    value: 'Staging'
  }
  {
    name: 'ConnectionStrings__DefaultConnection'
    secretRef: 'db-connection-string'
  }
]

// ── Secrets (pulled from Key Vault via managed identity) ───────────────────
// ⚠️  REQUIRED: Before deploying, you must:
//   1. Create an Azure Key Vault and add the secrets listed below.
//   2. Create a user-assigned managed identity and grant it "Key Vault Secrets User".
//   3. Replace the placeholder values below with your actual Key Vault name and identity resource ID.
//   4. Set `managedIdentityId` to the resource ID of the managed identity.
// See docs/SECRETS.md for the full setup guide.
param backendSecrets = [
  {
    name: 'db-connection-string'
    // Replace <KEYVAULT_NAME> with your Azure Key Vault name
    keyVaultUrl: 'https://<KEYVAULT_NAME>.vault.azure.net/secrets/db-connection-string'
    // Replace with the resource ID of the user-assigned managed identity
    // e.g. /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<name>
    identity: '<MANAGED_IDENTITY_RESOURCE_ID>'
  }
]
param uiSecrets = []

// ── Managed identity ─────────────────────────────────────────────────────
// ⚠️  REQUIRED if using Key Vault secrets: replace with the resource ID of your
// user-assigned managed identity.
// e.g. /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<name>
param managedIdentityId = '<MANAGED_IDENTITY_RESOURCE_ID>'
