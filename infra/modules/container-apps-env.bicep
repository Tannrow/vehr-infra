// Azure Container Apps Environment module
// Provides the shared managed environment (Log Analytics + Dapr) used by all Container Apps.

@description('Name of the Container Apps Environment')
param envName string

@description('Azure region to deploy into')
param location string

@description('Resource tags')
param tags object = {}

// Log Analytics workspace to capture environment logs
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${envName}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: envName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

@description('Resource ID of the managed environment')
output resourceId string = containerAppsEnv.id

@description('Name of the managed environment (for Container App references)')
output name string = containerAppsEnv.name
