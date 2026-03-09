// Azure Container Registry module
// Provisions a private container registry for storing Docker images.

@description('Name of the Container Registry (alphanumeric, 5-50 chars)')
param acrName string

@description('Azure region to deploy into')
param location string

@description('SKU for the registry — Basic for staging, Standard/Premium for production')
@allowed(['Basic', 'Standard', 'Premium'])
param sku string = 'Basic'

@description('Resource tags')
param tags object = {}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false // use managed identity / OIDC instead
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

@description('Login server URL, e.g. myregistry.azurecr.io')
output loginServer string = acr.properties.loginServer

@description('Resource ID of the registry')
output resourceId string = acr.id
