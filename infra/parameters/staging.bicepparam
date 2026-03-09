// Staging environment parameters
// Reference: infra/main.bicep
// Deploy with:
//   az deployment group create \
//     --resource-group <rg-staging> \
//     --template-file infra/main.bicep \
//     --parameters infra/parameters/staging.bicepparam

using '../main.bicep'

var keyVaultName = readEnvironmentVariable('KEY_VAULT_NAME_STAGING', '')
var managedIdentityResourceId = readEnvironmentVariable('MANAGED_IDENTITY_RESOURCE_ID_STAGING', '')
var hasBackendSecretConfig = !empty(keyVaultName) && !empty(managedIdentityResourceId)

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

param backendEnvVars = concat([
  {
    name: 'ASPNETCORE_ENVIRONMENT'
    value: 'Staging'
  }
], hasBackendSecretConfig ? [
  {
    name: 'ConnectionStrings__DefaultConnection'
    secretRef: 'db-connection-string'
  }
] : [])

// ── Secrets (pulled from Key Vault via managed identity) ───────────────────
// ⚠️  OPTIONAL: Configure these before deploying a backend that needs database access:
//   1. Create an Azure Key Vault and add the secrets listed below.
//   2. Create a user-assigned managed identity and grant it "Key Vault Secrets User".
//   3. Set KEY_VAULT_NAME_STAGING and MANAGED_IDENTITY_RESOURCE_ID_STAGING.
//      When omitted, staging plans/bootstrap deployments skip the backend Key Vault secret wiring.
// See docs/SECRETS.md for the full setup guide.
param backendSecrets = hasBackendSecretConfig ? [
  {
    name: 'db-connection-string'
    keyVaultUrl: 'https://${keyVaultName}.vault.azure.net/secrets/db-connection-string'
    identity: managedIdentityResourceId
  }
] : []
param uiSecrets = []

// ── Managed identity ─────────────────────────────────────────────────────
// Set MANAGED_IDENTITY_RESOURCE_ID_STAGING when the backend should use Key Vault/managed identity.
param managedIdentityId = hasBackendSecretConfig ? managedIdentityResourceId : ''
