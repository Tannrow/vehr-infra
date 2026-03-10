// Production environment parameters
// Reference: infra/main.bicep
// Deploy with:
//   az deployment group create \
//     --resource-group <rg-production> \
//     --template-file infra/main.bicep \
//     --parameters infra/parameters/production.bicepparam

using '../main.bicep'

param environment = 'production'
param location = 'eastus'

// ── Container Registry ──────────────────────────────────────────────────────
param acrName = 'vehracrprod'
param acrSku = 'Standard'

// ── Container Apps Environment ──────────────────────────────────────────────
param containerAppsEnvName = 'vehr-env-prod'

// ── App names ───────────────────────────────────────────────────────────────
param uiAppName = 'revenue-ui'
param backendAppName = 'vehr-api'
param controlTowerAppName = 'control-tower'

// ── Images — updated by the apply-production workflow ──────────────────────
param uiImage = 'vehracrprod.azurecr.io/revenue-ui:latest'
param backendImage = 'vehracrprod.azurecr.io/vehr:latest'
param controlTowerImage = ''

// ── Ports ───────────────────────────────────────────────────────────────────
param uiTargetPort = 80
param backendTargetPort = 8080
param controlTowerTargetPort = 3000

// ── Scaling ─────────────────────────────────────────────────────────────────
param uiMinReplicas = 1
param backendMinReplicas = 1
param controlTowerMinReplicas = 1

// ── Custom domains ──────────────────────────────────────────────────────────
param uiCustomDomains = [
  // {
  //   name: 'app.yourdomain.com'
  //   certificateId: '/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.App/managedEnvironments/<env>/certificates/<cert>'
  // }
]
param backendCustomDomains = []
param controlTowerCustomDomains = []

// ── Environment variables ───────────────────────────────────────────────────
param uiEnvVars = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'VITE_API_URL'
    value: 'https://api.yourdomain.com'
  }
]

param controlTowerEnvVars = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
]

param backendEnvVars = [
  {
    name: 'ASPNETCORE_ENVIRONMENT'
    value: 'Production'
  }
  {
    name: 'ConnectionStrings__DefaultConnection'
    secretRef: 'db-connection-string'
  }
]

// ── Secrets ──────────────────────────────────────────────────────────────────
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
    identity: '<MANAGED_IDENTITY_RESOURCE_ID>'
  }
]
param uiSecrets = []
param controlTowerSecrets = []

// ── Managed identity ─────────────────────────────────────────────────────
// ⚠️  REQUIRED if using Key Vault secrets: replace with the resource ID of your
// user-assigned managed identity.
// e.g. /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ManagedIdentity/userAssignedIdentities/<name>
param managedIdentityId = '<MANAGED_IDENTITY_RESOURCE_ID>'
param controlTowerManagedIdentityId = '<MANAGED_IDENTITY_RESOURCE_ID>'
