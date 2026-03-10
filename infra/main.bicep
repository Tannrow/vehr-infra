// vehr-infra — main Bicep template
// Orchestrates ACR, Container Apps Environment, UI app, backend app, and Control Tower.
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

@description('Full image reference for the optional Control Tower container app (leave empty to skip deployment)')
param controlTowerImage string = ''

@description('Name of the UI Container App')
param uiAppName string = 'revenue-ui'

@description('Name of the backend Container App')
param backendAppName string = 'vehr-api'

@description('Name of the Control Tower Container App')
param controlTowerAppName string = 'control-tower'

@description('Target port for the UI app')
param uiTargetPort int = 80

@description('Target port for the backend app')
param backendTargetPort int = 8080

@description('Target port for the Control Tower app')
param controlTowerTargetPort int = 3000

@description('Custom domain bindings for the UI app: [{ name, certificateId }]')
param uiCustomDomains array = []

@description('Custom domain bindings for the backend app: [{ name, certificateId }]')
param backendCustomDomains array = []

@description('Custom domain bindings for the Control Tower app: [{ name, certificateId }]')
param controlTowerCustomDomains array = []

@description('Environment variables for the UI app: [{ name, value|secretRef }]')
param uiEnvVars array = []

@description('Environment variables for the backend app: [{ name, value|secretRef }]')
param backendEnvVars array = []

@description('Environment variables for the Control Tower app: [{ name, value|secretRef }]')
param controlTowerEnvVars array = []

@description('Secrets for the UI app: [{ name, keyVaultUrl, identity }]')
param uiSecrets array = []

@description('Secrets for the backend app: [{ name, keyVaultUrl, identity }]')
param backendSecrets array = []

@description('Secrets for the Control Tower app: [{ name, keyVaultUrl, identity }]')
param controlTowerSecrets array = []

@description('Resource ID of a user-assigned managed identity for ACR pull + KV access (leave empty to skip)')
param managedIdentityId string = ''

@description('Resource ID of a user-assigned managed identity for the Control Tower app (leave empty to reuse managedIdentityId or skip)')
param controlTowerManagedIdentityId string = ''

@description('Minimum replicas for the UI app')
param uiMinReplicas int = 0

@description('Minimum replicas for the backend app')
param backendMinReplicas int = 0

@description('Minimum replicas for the Control Tower app')
param controlTowerMinReplicas int = 1

// ── Tags ────────────────────────────────────────────────────────────────────

var commonTags = {
  environment: environment
  managedBy: 'vehr-infra'
  repo: 'Tannrow/vehr-infra'
}

var shouldDeployControlTower = !empty(controlTowerImage)
var effectiveControlTowerManagedIdentityId = !empty(controlTowerManagedIdentityId) ? controlTowerManagedIdentityId : managedIdentityId

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

module controlTowerApp 'modules/container-app.bicep' = if (shouldDeployControlTower) {
  name: 'deploy-control-tower'
  params: {
    appName: controlTowerAppName
    location: location
    environmentId: env.outputs.resourceId
    containerImage: controlTowerImage
    targetPort: controlTowerTargetPort
    customDomains: controlTowerCustomDomains
    envVars: concat(controlTowerEnvVars, [
      {
        name: 'CONTROL_TOWER_ENVIRONMENT'
        value: environment
      }
      {
        name: 'CONTROL_TOWER_APP_NAME'
        value: controlTowerAppName
      }
      {
        name: 'CONTROL_TOWER_REVENUE_UI_APP_NAME'
        value: uiAppName
      }
      {
        name: 'CONTROL_TOWER_BACKEND_APP_NAME'
        value: backendAppName
      }
      {
        name: 'CONTROL_TOWER_REVENUE_UI_URL'
        value: 'https://${uiApp.outputs.fqdn}'
      }
      {
        name: 'CONTROL_TOWER_BACKEND_URL'
        value: 'https://${backendApp.outputs.fqdn}'
      }
      {
        name: 'AZURE_RESOURCE_GROUP'
        value: resourceGroup().name
      }
      {
        name: 'AZURE_SUBSCRIPTION_ID'
        value: subscription().subscriptionId
      }
      {
        name: 'AZURE_CONTAINER_APP_NAMES_JSON'
        value: string([
          uiAppName
          backendAppName
          controlTowerAppName
        ])
      }
      {
        name: 'CONTROL_TOWER_PLATFORM_CONFIG_JSON'
        value: string({
          environment: environment
          services: [
            {
              component_id: 'vehr-backend-api'
              endpoint: 'https://${backendApp.outputs.fqdn}/api/v1/health'
              metadata: {
                app_name: backendAppName
              }
            }
            {
              component_id: 'revenue-ui'
              endpoint: 'https://${uiApp.outputs.fqdn}/api/health'
              metadata: {
                app_name: uiAppName
              }
            }
          ]
          deployments: [
            {
              service: 'revenue-ui'
              app_name: uiAppName
              environment: environment
              health_verification: 'pending'
              rollback_eligible: false
              last_known_healthy_revision: 'unknown'
            }
            {
              service: 'vehr-backend-api'
              app_name: backendAppName
              environment: environment
              health_verification: 'pending'
              rollback_eligible: false
              last_known_healthy_revision: 'unknown'
            }
            {
              service: 'control-tower'
              app_name: controlTowerAppName
              environment: environment
              health_verification: 'pending'
              rollback_eligible: false
              last_known_healthy_revision: 'unknown'
            }
          ]
          database: {
            expected_tables: [
              'claims'
              'claim_ledgers'
              'revenue_snapshots'
              'era_imports'
              'documents'
            ]
          }
          environment_profiles: {
            staging: {
              ui_min_replicas: 0
              backend_min_replicas: 0
              control_tower_min_replicas: 1
            }
            production: {
              ui_min_replicas: 1
              backend_min_replicas: 1
              control_tower_min_replicas: 1
            }
          }
        })
      }
    ])
    secrets: controlTowerSecrets
    managedIdentityId: effectiveControlTowerManagedIdentityId
    minReplicas: controlTowerMinReplicas
    tags: union(commonTags, {
      role: 'control-tower'
    })
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────────

output acrLoginServer string = acr.outputs.loginServer
output uiFqdn string = uiApp.outputs.fqdn
output backendFqdn string = backendApp.outputs.fqdn
output controlTowerFqdn string = shouldDeployControlTower ? controlTowerApp!.outputs.fqdn : ''
