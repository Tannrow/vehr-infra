// Azure Container App module
// Deploys a single Container App with configurable image, env vars, secrets, and ingress.

@description('Name of the Container App')
param appName string

@description('Azure region to deploy into')
param location string

@description('Resource ID of the Container Apps Environment')
param environmentId string

@description('Full container image reference, e.g. myregistry.azurecr.io/revenue-ui:1.0.0')
param containerImage string

@description('CPU allocation in vCPU — must match a Container Apps valid size')
@allowed(['0.25', '0.5', '0.75', '1.0', '1.25', '1.5', '1.75', '2.0'])
param cpu string = '0.5'

@description('Memory allocation')
param memory string = '1Gi'

@description('Minimum number of replicas (0 = scale to zero)')
param minReplicas int = 0

@description('Maximum number of replicas')
param maxReplicas int = 3

@description('Enable external HTTP ingress')
param externalIngress bool = true

@description('Target port the container listens on')
param targetPort int = 80

@description('Custom domain bindings. Each entry: { name, certificateId }')
param customDomains array = []

@description('''
Environment variables to inject.
Each entry must be one of:
  { name: string, value: string }                      — plain value
  { name: string, secretRef: string }                  — reference to a secret defined in `secrets`
''')
param envVars array = []

@description('''
Secrets to store in the Container App.
Each entry: { name: string, keyVaultUrl: string, identity: string }
The `identity` should be the resource ID of a user-assigned managed identity
that has "Key Vault Secrets User" on the referenced vault.
''')
param secrets array = []

@description('Resource ID of a user-assigned managed identity for ACR pull and Key Vault access')
param managedIdentityId string = ''

@description('Resource tags')
param tags object = {}

var identityConfig = managedIdentityId != '' ? {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${managedIdentityId}': {}
  }
} : {
  type: 'None'
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  tags: tags
  identity: identityConfig
  properties: {
    environmentId: environmentId
    configuration: {
      ingress: {
        external: externalIngress
        targetPort: targetPort
        transport: 'auto'
        customDomains: [for domain in customDomains: {
          name: domain.name
          certificateId: domain.certificateId
          bindingType: 'SniEnabled'
        }]
      }
      secrets: [for secret in secrets: {
        name: secret.name
        keyVaultUrl: secret.keyVaultUrl
        identity: secret.identity
      }]
      registries: managedIdentityId != '' ? [
        {
          // ACR login server is inferred from the container image
          server: split(containerImage, '/')[0]
          identity: managedIdentityId
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: appName
          image: containerImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: envVars
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

@description('FQDN of the deployed Container App')
output fqdn string = containerApp.properties.configuration.ingress.fqdn

@description('Resource ID of the Container App')
output resourceId string = containerApp.id
