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
// Shared staging resources stay on their legacy footprint, but the staging
// application runtime is explicitly deployed in East US 2.
param location = 'eastus2'

// ── Container Registry ──────────────────────────────────────────────────────
// Reuse the long-lived staging registry; it remains a shared staging resource.
param acrName = 'vehrrevostagingacr'
param acrSku = 'Basic'
param acrExists = true

// ── Container Apps Environment ──────────────────────────────────────────────
// The Container Apps environment is region-bound, so East US 2 gets its own
// unique environment name instead of trying to recreate the legacy East US one.
param containerAppsEnvName = 'vehr-env-staging-eastus2'
param containerAppsEnvExists = false
// Reuse the shared staging workspace instead of duplicating logs per region.
param logAnalyticsWorkspaceName = 'vehr-env-staging-logs'
param logAnalyticsWorkspaceExists = true

// ── App names ───────────────────────────────────────────────────────────────
// The runtime region is East US 2, but the live staging app identities and
// app-repo workflows already target the established `-eus2` app names.
param uiAppName = 'vehr-revenue-ui-staging-eus2'
param backendAppName = 'vehr-revos-staging-eus2'
param controlTowerAppName = 'control-tower-staging-eus2'

// ── Images — updated by the apply-staging workflow ─────────────────────────
// Format: <acrLoginServer>/<repo>:<tag>
param uiImage = 'vehrrevostagingacr.azurecr.io/vehr-revenue-ui:latest'
param backendImage = 'vehrrevostagingacr.azurecr.io/vehr-api:latest'
param controlTowerImage = ''

// ── Ports ───────────────────────────────────────────────────────────────────
param uiTargetPort = 3000
param backendTargetPort = 8000
param controlTowerTargetPort = 3000

// ── Scaling ─────────────────────────────────────────────────────────────────
param uiMinReplicas = 0
param backendMinReplicas = 1
param controlTowerMinReplicas = 1

// ── Custom domains (leave empty until certs are provisioned) ─────────────
param uiCustomDomains = []
param backendCustomDomains = []
param controlTowerCustomDomains = []

// ── Environment variables ───────────────────────────────────────────────────
// Plain values only here; secrets use secretRef pointing to the secrets array below.
param uiEnvVars = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
]

param controlTowerEnvVars = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
]

param backendEnvVars = hasBackendSecretConfig ? [
  {
    name: 'DATABASE_URL'
    secretRef: 'db-connection-string'
  }
] : []

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
param controlTowerSecrets = []

// ── Managed identity ─────────────────────────────────────────────────────
// Set MANAGED_IDENTITY_RESOURCE_ID_STAGING when staging apps should use ACR pull + managed identity.
param managedIdentityId = managedIdentityResourceId
param controlTowerManagedIdentityId = managedIdentityResourceId
