import net from 'node:net';
import { SEVERITIES, STATUSES, inferSeverity, toIsoString } from './model.js';

const ARM_RESOURCE = 'https://management.azure.com/';
const ARM_API_VERSION = '2024-03-01';

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getConfiguredAppNames(env, snapshot) {
  const snapshotAppNames = (snapshot.apps ?? []).map((app) => app.app_name ?? app.name);
  return JSON.parse(env.AZURE_CONTAINER_APP_NAMES_JSON ?? JSON.stringify(snapshotAppNames));
}

function databaseRecommendedAction({ missingTables, connectivitySkipped, hasTableInventory }) {
  if (missingTables.includes('claim_ledgers')) {
    return 'Snapshot worker is unsafe to run until the claim_ledgers table is restored.';
  }

  if (connectivitySkipped && !hasTableInventory) {
    return 'Provide a database snapshot or host target to enable runtime schema diagnostics.';
  }

  return 'Validate migrations and investigate failed background writes.';
}

function classifyHttpStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) {
    return { status: STATUSES.HEALTHY, severity: SEVERITIES.INFO };
  }

  if (statusCode >= 500) {
    return { status: STATUSES.FAILED, severity: SEVERITIES.CRITICAL };
  }

  return { status: STATUSES.DEGRADED, severity: SEVERITIES.WARNING };
}

export class ServiceProbeAdapter {
  async collect(services) {
    const results = await Promise.all(services.map(async (service) => {
      const heartbeat = nowIso();
      if (!service.endpoint) {
        return {
          component_id: service.component_id,
          status: service.status ?? STATUSES.UNKNOWN,
          severity: inferSeverity(service.status ?? STATUSES.UNKNOWN, service.severity),
          message: service.message ?? `${service.name} endpoint is not configured.`,
          last_heartbeat_at: heartbeat,
          metadata: {
            endpoint_configured: false,
            ...service.metadata
          }
        };
      }

      const started = performance.now();

      try {
        const response = await fetch(service.endpoint, {
          method: 'GET',
          headers: {
            accept: 'application/json, text/plain;q=0.8, */*;q=0.5'
          }
        });

        const latency_ms = Math.round(performance.now() - started);
        const classification = classifyHttpStatus(response.status);
        const text = await response.text();

        return {
          component_id: service.component_id,
          status: classification.status,
          severity: classification.severity,
          message: `${service.name} responded with HTTP ${response.status}.`,
          last_heartbeat_at: heartbeat,
          last_success_at: response.ok ? heartbeat : null,
          last_failure_at: response.ok ? null : heartbeat,
          metadata: {
            endpoint: service.endpoint,
            health_endpoint_result: response.status,
            latency_ms,
            error_rate: response.ok ? 0 : 1,
            last_known_good_state: response.ok ? 'healthy' : 'degraded',
            response_excerpt: text.slice(0, 240),
            ...service.metadata
          }
        };
      } catch (error) {
        return {
          component_id: service.component_id,
          status: STATUSES.FAILED,
          severity: SEVERITIES.CRITICAL,
          message: `${service.name} probe failed: ${error.message}`,
          last_heartbeat_at: heartbeat,
          last_failure_at: heartbeat,
          metadata: {
            endpoint: service.endpoint,
            error_rate: 1,
            last_known_good_state: 'unknown',
            probe_error: error.message,
            ...service.metadata
          }
        };
      }
    }));

    return new Map(results.map((result) => [result.component_id, result]));
  }
}

export class RuntimeSnapshotAdapter {
  constructor(snapshot = {}) {
    this.snapshot = snapshot;
  }

  collect() {
    const workers = new Map((this.snapshot.workers ?? []).map((worker) => [worker.component_id, {
      ...worker,
      last_success_at: toIsoString(worker.last_success_at),
      last_failure_at: toIsoString(worker.last_failure_at),
      metadata: {
        queue_size: safeNumber(worker.queue_size ?? worker.metadata?.queue_size),
        backlog: safeNumber(worker.backlog ?? worker.metadata?.backlog),
        last_run_at: toIsoString(worker.last_run_at ?? worker.metadata?.last_run_at),
        last_duration_ms: safeNumber(worker.last_duration_ms ?? worker.metadata?.last_duration_ms),
        recent_failures: worker.recent_failures ?? worker.metadata?.recent_failures ?? [],
        ...worker.metadata
      }
    }]));

    const pipelines = new Map((this.snapshot.pipelines ?? []).map((pipeline) => [pipeline.component_id, {
      ...pipeline,
      last_success_at: toIsoString(pipeline.last_success_at),
      last_failure_at: toIsoString(pipeline.last_failure_at),
      metadata: {
        duration_ms: safeNumber(pipeline.duration_ms ?? pipeline.metadata?.duration_ms),
        throughput_per_hour: safeNumber(pipeline.throughput_per_hour ?? pipeline.metadata?.throughput_per_hour),
        blocked_stage: pipeline.blocked_stage ?? pipeline.metadata?.blocked_stage ?? null,
        dependent_services: pipeline.dependent_services ?? pipeline.metadata?.dependent_services ?? [],
        current_failure_reason: pipeline.current_failure_reason ?? pipeline.metadata?.current_failure_reason ?? null,
        safe_retry_action: pipeline.safe_retry_action ?? pipeline.metadata?.safe_retry_action ?? null,
        ...pipeline.metadata
      }
    }]));

    return { workers, pipelines };
  }
}

async function getManagedIdentityToken() {
  const url = new URL('http://169.254.169.254/metadata/identity/oauth2/token');
  url.searchParams.set('api-version', '2018-02-01');
  url.searchParams.set('resource', ARM_RESOURCE);

  const response = await fetch(url, {
    headers: {
      Metadata: 'true'
    }
  });

  if (!response.ok) {
    throw new Error(`Managed identity token request failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  return body.access_token;
}

async function fetchArmJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Azure ARM request failed with HTTP ${response.status}`);
  }

  return response.json();
}

function parseArmContainerApp(app) {
  const ingress = app.properties?.configuration?.ingress ?? {};
  const template = app.properties?.template ?? {};
  const latestRevision = app.properties?.latestReadyRevisionName ?? app.properties?.latestRevisionName ?? 'unknown';
  const fqdn = ingress.fqdn ?? null;
  const minReplicas = template.scale?.minReplicas ?? 0;
  const maxReplicas = template.scale?.maxReplicas ?? 0;
  const envVars = template.containers?.[0]?.env ?? [];
  const missingEnvVars = envVars.filter((variable) => variable.required === true && variable.value == null && variable.secretRef == null);

  return {
    app_name: app.name,
    current_revision: latestRevision,
    latest_revision_name: app.properties?.latestRevisionName ?? latestRevision,
    ingress_fqdn: fqdn,
    external_ingress: ingress.external ?? false,
    replica_count: app.properties?.template?.scale?.minReplicas ?? minReplicas,
    revision_health: app.properties?.runningStatus ?? 'unknown',
    min_replicas: minReplicas,
    max_replicas: maxReplicas,
    env_var_validation: {
      configured_count: envVars.length,
      missing_required: missingEnvVars.map((variable) => variable.name)
    },
    deployment_revision_metadata: {
      image: template.containers?.[0]?.image ?? 'unknown',
      revision_mode: app.properties?.configuration?.activeRevisionsMode ?? 'single'
    }
  };
}

export class AzureOperationsAdapter {
  constructor({ env = process.env, snapshot = {} } = {}) {
    this.env = env;
    this.snapshot = snapshot;
  }

  async collect(config) {
    const resourceGroup = this.env.AZURE_RESOURCE_GROUP ?? this.snapshot.resource_group ?? null;
    const subscriptionId = this.env.AZURE_SUBSCRIPTION_ID ?? this.snapshot.subscription_id ?? null;
    const appNames = getConfiguredAppNames(this.env, this.snapshot);

    if (!subscriptionId || !resourceGroup || appNames.length === 0) {
      return {
        deployments: this.snapshot.deployments ?? config.deployments,
        infrastructure: [
          {
            component_id: 'azure-container-apps',
            status: STATUSES.UNKNOWN,
            severity: SEVERITIES.WARNING,
            message: 'Azure ARM adapter is not configured; using static deployment metadata.',
            metadata: {
              adapter: 'snapshot'
            }
          }
        ]
      };
    }

    try {
      const token = await getManagedIdentityToken();
      const apps = await Promise.all(appNames.map(async (appName) => {
        const url = `${ARM_RESOURCE}subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.App/containerApps/${appName}?api-version=${ARM_API_VERSION}`;
        const response = await fetchArmJson(url, token);
        return parseArmContainerApp(response);
      }));

      const deploymentMap = new Map(config.deployments.map((deployment) => [deployment.app_name, deployment]));
      const deployments = apps.map((app) => {
        const existing = deploymentMap.get(app.app_name) ?? { service: app.app_name, environment: config.environment };
        const revisionHealth = /running|ready|healthy/i.test(app.revision_health) ? 'passed' : 'investigate';
        return {
          ...existing,
          revision: app.current_revision,
          started_at: null,
          completed_at: null,
          health_verification: revisionHealth,
          rollback_eligible: app.current_revision !== 'unknown',
          last_known_healthy_revision: existing.last_known_healthy_revision ?? app.current_revision,
          azure: app
        };
      });

      return {
        deployments,
        infrastructure: [
          {
            component_id: 'azure-container-apps',
            status: deployments.some((deployment) => deployment.health_verification !== 'passed') ? STATUSES.DEGRADED : STATUSES.HEALTHY,
            severity: deployments.some((deployment) => deployment.health_verification !== 'passed') ? SEVERITIES.WARNING : SEVERITIES.INFO,
            message: `Collected revision state for ${deployments.length} Container Apps from Azure ARM.`,
            metadata: {
              adapter: 'azure-arm',
              resource_group: resourceGroup,
              apps: apps
            }
          },
          {
            component_id: 'deployment-state',
            status: deployments.some((deployment) => deployment.health_verification !== 'passed') ? STATUSES.DEGRADED : STATUSES.HEALTHY,
            severity: deployments.some((deployment) => deployment.health_verification !== 'passed') ? SEVERITIES.WARNING : SEVERITIES.INFO,
            message: 'Deployment verification data refreshed from Azure.',
            metadata: {
              deployments
            }
          },
          {
            component_id: 'rollback-state',
            status: deployments.every((deployment) => deployment.rollback_eligible) ? STATUSES.HEALTHY : STATUSES.DEGRADED,
            severity: deployments.every((deployment) => deployment.rollback_eligible) ? SEVERITIES.INFO : SEVERITIES.WARNING,
            message: 'Rollback metadata recalculated from Azure revision state.',
            metadata: {
              rollback_eligible_services: deployments.filter((deployment) => deployment.rollback_eligible).map((deployment) => deployment.service)
            }
          }
        ]
      };
    } catch (error) {
      return {
        deployments: this.snapshot.deployments ?? config.deployments,
        infrastructure: [
          {
            component_id: 'azure-container-apps',
            status: STATUSES.DEGRADED,
            severity: SEVERITIES.WARNING,
            message: `Azure ARM adapter failed: ${error.message}`,
            metadata: {
              adapter: 'azure-arm',
              error: error.message,
              resource_group: resourceGroup
            }
          }
        ]
      };
    }
  }
}

export class DatabaseAdapter {
  constructor(snapshot = {}) {
    this.snapshot = snapshot;
  }

  async collect(config) {
    const database = {
      ...config.database,
      ...this.snapshot
    };

    const connectivity = await this.checkConnectivity(database.host, database.port);
    const hasTableInventory = Array.isArray(database.tables_present);
    const tablesPresent = hasTableInventory ? database.tables_present : [];
    const missingTables = hasTableInventory
      ? database.expected_tables.filter((table) => !tablesPresent.includes(table))
      : [];
    const failedBackgroundWrites = database.failed_background_writes ?? [];

    let status = connectivity.skipped && !hasTableInventory ? STATUSES.UNKNOWN : STATUSES.HEALTHY;
    let severity = connectivity.skipped && !hasTableInventory ? SEVERITIES.WARNING : SEVERITIES.INFO;
    const messages = [];

    if (!connectivity.connected && database.host) {
      status = STATUSES.FAILED;
      severity = SEVERITIES.CRITICAL;
      messages.push(`PostgreSQL connectivity failed on ${database.host}:${database.port}.`);
    }

    if (missingTables.length > 0) {
      status = STATUSES.FAILED;
      severity = SEVERITIES.CRITICAL;
      messages.push(`Missing critical tables: ${missingTables.join(', ')}.`);
    }

    if (database.schema_drift_indicators?.length) {
      status = status === STATUSES.FAILED ? status : STATUSES.DEGRADED;
      severity = status === STATUSES.FAILED ? severity : SEVERITIES.WARNING;
      messages.push(`Schema drift indicators: ${database.schema_drift_indicators.join(', ')}.`);
    }

    if (failedBackgroundWrites.length > 0) {
      status = status === STATUSES.FAILED ? status : STATUSES.DEGRADED;
      severity = status === STATUSES.FAILED ? severity : SEVERITIES.WARNING;
      messages.push(`Failed background writes detected: ${failedBackgroundWrites.join(', ')}.`);
    }

    if (messages.length === 0) {
      messages.push(database.host
        ? 'Database connectivity and schema checks passed.'
        : hasTableInventory
          ? 'Database schema inventory loaded without direct connectivity target.'
          : 'Database snapshot is not configured yet.');
    }

    const component = {
      component_id: 'postgresql-runtime',
      status,
      severity,
      message: messages.join(' '),
      last_success_at: status === STATUSES.HEALTHY ? nowIso() : null,
      last_failure_at: status === STATUSES.HEALTHY ? null : nowIso(),
      metadata: {
        connectivity,
        migration_version: database.migration_version ?? null,
        expected_tables: database.expected_tables,
        tables_present: tablesPresent,
        missing_tables: missingTables,
        schema_drift_indicators: database.schema_drift_indicators ?? [],
        failed_background_writes: failedBackgroundWrites
      }
    };

    return {
      infrastructure: [component],
      serviceOverride: {
        component_id: 'postgresql-connectivity',
        status,
        severity,
        message: component.message,
        last_success_at: component.last_success_at,
        last_failure_at: component.last_failure_at,
        metadata: {
          connectivity,
          migration_version: database.migration_version ?? null,
          missing_tables: missingTables,
          schema_drift_indicators: database.schema_drift_indicators ?? [],
          failed_background_writes: failedBackgroundWrites
        },
        recommended_action: databaseRecommendedAction({
          missingTables,
          connectivitySkipped: connectivity.skipped,
          hasTableInventory
        })
      }
    };
  }

  async checkConnectivity(host, port) {
    if (!host) {
      return { connected: false, skipped: true, reason: 'No CONTROL_TOWER_DATABASE_HOST configured.' };
    }

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout: 2000 }, () => {
        socket.end();
        resolve({ connected: true, host, port });
      });

      socket.on('error', (error) => {
        resolve({ connected: false, host, port, reason: error.message });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ connected: false, host, port, reason: 'Timed out.' });
      });
    });
  }
}

export class WebhookCommandExecutor {
  constructor(webhooks = {}) {
    this.webhooks = webhooks;
  }

  async execute(command) {
    const webhook = this.webhooks[command.type];

    if (!webhook) {
      return {
        status: 'accepted',
        message: 'No remote executor is configured; command recorded for operator follow-up.',
        remote: false
      };
    }

    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(command)
    });

    const body = await response.text();

    return {
      status: response.ok ? 'completed' : 'failed',
      message: body.slice(0, 500) || `Webhook responded with HTTP ${response.status}`,
      remote: true,
      response_status: response.status
    };
  }
}
