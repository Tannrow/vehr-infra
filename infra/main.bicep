// vehr-infra — main Bicep template
// Orchestrates ACR, Container Apps Environment, UI app, and backend app.
// Deployed per-environment via parameter files in infra/parameters/.

targetScope = 'resourceGroup'

// ── Parameters ─────────────────────────────────────────────────────────────

@description('Short environment tag, e.g. staging or production')
param environment string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Name of the Azure Container Registry (alphanumeric, 5-50 chars)')
param acrName string

@description('ACR SKU')
@allowed(['Basic', 'Standard', 'Premium'])
param acrSku string = 'Basic'

@description('Name of the Container Apps managed environment')
param containerAppsEnvName string

@description('Full image reference for the UI container app')
param uiImage string

@description('Full image reference for the backend (VEHR) container app')
param backendImage string

@description('Name of the UI Container App')
param uiAppName string = 'revenue-ui'

@description('Name of the backend Container App')
param backendAppName string = 'vehr-api'

@description('Target port for the UI app')
param uiTargetPort int = 80

@description('Target port for the backend app')
param backendTargetPort int = 8080

@description('Custom domain bindings for the UI app: [{ name, certificateId }]')
param uiCustomDomains array = []

@description('Custom domain bindings for the backend app: [{ name, certificateId }]')
param backendCustomDomains array = []

@description('Environment variables for the UI app: [{ name, value|secretRef }]')
param uiEnvVars array = []

@description('Environment variables for the backend app: [{ name, value|secretRef }]')
param backendEnvVars array = []

@description('Secrets for the UI app: [{ name, keyVaultUrl, identity }]')
param uiSecrets array = []

@description('Secrets for the backend app: [{ name, keyVaultUrl, identity }]')
param backendSecrets array = []

@description('Resource ID of a user-assigned managed identity for ACR pull + KV access (leave empty to skip)')
param managedIdentityId string = ''

@description('Minimum replicas for the UI app')
param uiMinReplicas int = 0

@description('Minimum replicas for the backend app')
param backendMinReplicas int = 0

// ── Tags ────────────────────────────────────────────────────────────────────

var commonTags = {
  environment: environment
  managedBy: 'vehr-infra'
  repo: 'Tannrow/vehr-infra'
}

// ── Modules ─────────────────────────────────────────────────────────────────

module acr 'modules/container-registry.bicep' = {
  name: 'deploy-acr'
  params: {
    acrName: acrName
    location: location
    sku: acrSku
    tags: commonTags
  }
}

module env 'modules/container-apps-env.bicep' = {
  name: 'deploy-env'
  params: {
    envName: containerAppsEnvName
    location: location
    tags: commonTags
  }
}

module uiApp 'modules/container-app.bicep' = {
  name: 'deploy-ui'
  params: {
    appName: uiAppName
    location: location
    environmentId: env.outputs.resourceId
    containerImage: uiImage
    targetPort: uiTargetPort
    customDomains: uiCustomDomains
    envVars: uiEnvVars
    secrets: uiSecrets
    managedIdentityId: managedIdentityId
    minReplicas: uiMinReplicas
    tags: commonTags
  }
}

module backendApp 'modules/container-app.bicep' = {
  name: 'deploy-backend'
  params: {
    appName: backendAppName
    location: location
    environmentId: env.outputs.resourceId
    containerImage: backendImage
    targetPort: backendTargetPort
    customDomains: backendCustomDomains
    envVars: backendEnvVars
    secrets: backendSecrets
    managedIdentityId: managedIdentityId
    minReplicas: backendMinReplicas
    tags: commonTags
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────────

output acrLoginServer string = acr.outputs.loginServer
output uiFqdn string = uiApp.outputs.fqdn
output backendFqdn string = backendApp.outputs.fqdn
