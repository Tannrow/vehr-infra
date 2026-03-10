// Azure Container Apps Environment module
// Provides the shared managed environment (Log Analytics + Dapr) used by all Container Apps.

@description('Name of the Container Apps Environment')
param envName string

@description('Azure region to deploy into')
param location string

@description('When true, reference an existing Container Apps managed environment instead of creating it')
param useExistingEnvironment bool = false

@description('Optional override for the Log Analytics workspace name')
param logAnalyticsWorkspaceName string = ''

@description('When true, reference an existing Log Analytics workspace instead of creating it')
param useExistingLogAnalyticsWorkspace bool = false

@description('Resource tags')
param tags object = {}

var effectiveLogAnalyticsWorkspaceName = empty(logAnalyticsWorkspaceName) ? '${envName}-logs' : logAnalyticsWorkspaceName

// Log Analytics workspace to capture environment logs
resource existingLogAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = if (useExistingLogAnalyticsWorkspace) {
  name: effectiveLogAnalyticsWorkspaceName
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = if (!useExistingLogAnalyticsWorkspace) {
  name: effectiveLogAnalyticsWorkspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource existingContainerAppsEnv 'Microsoft.App/managedEnvironments@2023-05-01' existing = if (useExistingEnvironment) {
  name: envName
}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2023-05-01' = if (!useExistingEnvironment) {
  name: envName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: useExistingLogAnalyticsWorkspace ? existingLogAnalytics!.properties.customerId : logAnalytics!.properties.customerId
        sharedKey: useExistingLogAnalyticsWorkspace ? existingLogAnalytics!.listKeys().primarySharedKey : logAnalytics!.listKeys().primarySharedKey
      }
    }
  }
}

@description('Resource ID of the managed environment')
output resourceId string = useExistingEnvironment ? existingContainerAppsEnv.id : containerAppsEnv.id

@description('Name of the managed environment (for Container App references)')
output name string = useExistingEnvironment ? existingContainerAppsEnv.name : containerAppsEnv.name
