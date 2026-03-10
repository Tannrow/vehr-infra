import { COMPONENT_TYPES, STATUSES, SEVERITIES, inferSeverity, toIsoString } from './model.js';

function readJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      ...fallback,
      __parse_error: `Unable to parse ${name}: ${error.message}`
    };
  }
}

function endpoint(url, healthPath = '/') {
  if (!url) {
    return null;
  }

  if (/^https?:\/\//.test(url)) {
    return url;
  }

  return `${url.replace(/\/$/, '')}${healthPath}`;
}

function service(id, name, options = {}) {
  return {
    component_id: id,
    component_type: COMPONENT_TYPES.SERVICE,
    name,
    endpoint: options.endpoint ?? null,
    status: options.status ?? STATUSES.UNKNOWN,
    severity: options.severity ?? inferSeverity(options.status),
    message: options.message ?? `${name} health has not yet been sampled.`,
    recommended_action: options.recommended_action ?? 'Refresh service health telemetry.',
    metadata: {
      category: 'service',
      ...options.metadata
    }
  };
}

function worker(id, name, options = {}) {
  return {
    component_id: id,
    component_type: COMPONENT_TYPES.WORKER,
    name,
    status: options.status ?? STATUSES.UNKNOWN,
    severity: options.severity ?? inferSeverity(options.status),
    message: options.message ?? `${name} runtime state is waiting for telemetry.`,
    recommended_action: options.recommended_action ?? 'Inspect the worker queue and refresh diagnostics.',
    metadata: {
      queue_size: options.queue_size ?? null,
      backlog: options.backlog ?? null,
      last_run_at: toIsoString(options.last_run_at),
      last_duration_ms: options.last_duration_ms ?? null,
      recent_failures: options.recent_failures ?? [],
      ...options.metadata
    },
    last_success_at: toIsoString(options.last_success_at),
    last_failure_at: toIsoString(options.last_failure_at)
  };
}

function pipeline(id, name, options = {}) {
  return {
    component_id: id,
    component_type: COMPONENT_TYPES.PIPELINE,
    name,
    status: options.status ?? STATUSES.UNKNOWN,
    severity: options.severity ?? inferSeverity(options.status),
    message: options.message ?? `${name} execution summary is not yet available.`,
    recommended_action: options.recommended_action ?? 'Review the failed stage and use the suggested safe retry.',
    metadata: {
      throughput_per_hour: options.throughput_per_hour ?? null,
      blocked_stage: options.blocked_stage ?? null,
      dependent_services: options.dependent_services ?? [],
      current_failure_reason: options.current_failure_reason ?? null,
      safe_retry_action: options.safe_retry_action ?? null,
      duration_ms: options.duration_ms ?? null,
      ...options.metadata
    },
    last_success_at: toIsoString(options.last_success_at),
    last_failure_at: toIsoString(options.last_failure_at)
  };
}

function infrastructure(id, name, options = {}) {
  return {
    component_id: id,
    component_type: COMPONENT_TYPES.INFRASTRUCTURE,
    name,
    status: options.status ?? STATUSES.UNKNOWN,
    severity: options.severity ?? inferSeverity(options.status),
    message: options.message ?? `${name} checks have not yet been collected.`,
    recommended_action: options.recommended_action ?? 'Inspect infrastructure diagnostics.',
    metadata: {
      ...options.metadata
    },
    last_success_at: toIsoString(options.last_success_at),
    last_failure_at: toIsoString(options.last_failure_at)
  };
}

function defaultPlatformConfig() {
  const uiBaseUrl = process.env.CONTROL_TOWER_REVENUE_UI_URL ?? process.env.CONTROL_TOWER_UI_URL ?? null;
  const backendBaseUrl = process.env.CONTROL_TOWER_BACKEND_URL ?? null;

  return {
    environment: process.env.CONTROL_TOWER_ENVIRONMENT ?? process.env.NODE_ENV ?? 'staging',
    services: [
      service('vehr-backend-api', 'VEHR backend API', {
        endpoint: endpoint(process.env.CONTROL_TOWER_BACKEND_HEALTH_URL ?? backendBaseUrl, '/api/v1/health'),
        recommended_action: 'Inspect API health, deployment revision, and PostgreSQL connectivity.'
      }),
      service('revenue-ui', 'Revenue UI', {
        endpoint: endpoint(process.env.CONTROL_TOWER_REVENUE_UI_HEALTH_URL ?? uiBaseUrl, '/api/health'),
        recommended_action: 'Validate UI ingress, frontend asset deployment, and API reachability.'
      }),
      service('auth-session-layer', 'Auth / session layer', {
        endpoint: process.env.CONTROL_TOWER_AUTH_HEALTH_URL ?? null,
        recommended_action: 'Check identity provider status and session signing configuration.'
      }),
      service('postgresql-connectivity', 'PostgreSQL connectivity', {
        recommended_action: 'Validate database connectivity, migrations, and critical tables.',
        metadata: {
          datasource: 'database-adapter'
        }
      }),
      service('storage-document-services', 'Storage / document services', {
        endpoint: process.env.CONTROL_TOWER_STORAGE_HEALTH_URL ?? null,
        recommended_action: 'Check blob storage reachability and document ingestion failures.'
      }),
      service('ai-endpoints', 'AI endpoints', {
        endpoint: process.env.CONTROL_TOWER_AI_HEALTH_URL ?? null,
        recommended_action: 'Inspect model endpoint latency, quota, and command execution flow.'
      }),
      service('webhook-endpoints', 'Webhook endpoints', {
        endpoint: process.env.CONTROL_TOWER_WEBHOOK_HEALTH_URL ?? null,
        recommended_action: 'Validate webhook ingress, signing secrets, and downstream retries.'
      })
    ],
    workers: [
      worker('revenue-snapshot-worker', 'Revenue snapshot worker', {
        status: STATUSES.UNKNOWN,
        message: 'Awaiting worker heartbeat.',
        recommended_action: 'Run system diagnostics or trigger a revenue snapshot dry-run.'
      }),
      worker('era-ingestion-worker', 'ERA ingestion worker', {
        status: STATUSES.UNKNOWN,
        recommended_action: 'Review ERA ingestion backlog and recent parse failures.'
      }),
      worker('claim-reconciliation-worker', 'Claim reconciliation worker', {
        status: STATUSES.UNKNOWN,
        recommended_action: 'Inspect reconciliation backlog and retry any failed claim batches.'
      }),
      worker('document-ingestion-worker', 'Document ingestion worker', {
        status: STATUSES.UNKNOWN,
        recommended_action: 'Check storage reachability and extraction queue depth.'
      }),
      worker('ai-background-jobs', 'AI background jobs', {
        status: STATUSES.UNKNOWN,
        recommended_action: 'Inspect model endpoint health and failed job payloads.'
      })
    ],
    pipelines: [
      pipeline('revenue-snapshot-generation', 'Revenue snapshot generation', {
        safe_retry_action: 'trigger_revenue_snapshot',
        dependent_services: ['vehr-backend-api', 'postgresql-connectivity']
      }),
      pipeline('era-import-parsing', 'ERA import and parsing', {
        safe_retry_action: 'retry_era_pipeline',
        dependent_services: ['vehr-backend-api', 'storage-document-services']
      }),
      pipeline('claim-ingestion', 'Claim ingestion', {
        safe_retry_action: 'reprocess_claim_batch',
        dependent_services: ['vehr-backend-api', 'webhook-endpoints']
      }),
      pipeline('claim-reconciliation', 'Claim reconciliation', {
        safe_retry_action: 'reprocess_claim_batch',
        dependent_services: ['postgresql-connectivity', 'vehr-backend-api']
      }),
      pipeline('ai-analysis-jobs', 'AI analysis jobs', {
        safe_retry_action: 'run_system_diagnostics',
        dependent_services: ['ai-endpoints', 'vehr-backend-api']
      }),
      pipeline('document-extraction', 'Document extraction', {
        safe_retry_action: 'restart_worker',
        dependent_services: ['storage-document-services', 'ai-endpoints']
      })
    ],
    infrastructure: [
      infrastructure('azure-container-apps', 'Azure Container Apps', {
        recommended_action: 'Validate revision readiness, replica health, and ingress state.'
      }),
      infrastructure('deployment-state', 'Deployment state', {
        recommended_action: 'Review active revisions, deployment health verification, and rollback eligibility.'
      }),
      infrastructure('rollback-state', 'Rollback state', {
        recommended_action: 'Confirm the last healthy revision and rollback safety before intervention.'
      }),
      infrastructure('postgresql-runtime', 'PostgreSQL runtime', {
        recommended_action: 'Inspect migrations, schema drift, and failed writes.'
      })
    ],
    deployments: [
      {
        service: 'revenue-ui',
        app_name: process.env.CONTROL_TOWER_REVENUE_UI_APP_NAME ?? 'vehr-revenue-ui-staging-eus2',
        revision: 'unknown',
        environment: 'staging',
        health_verification: 'unknown',
        rollback_eligible: false,
        last_known_healthy_revision: 'unknown'
      },
      {
        service: 'vehr-backend-api',
        app_name: process.env.CONTROL_TOWER_BACKEND_APP_NAME ?? 'vehr-revos-staging-eus2',
        revision: 'unknown',
        environment: 'staging',
        health_verification: 'unknown',
        rollback_eligible: false,
        last_known_healthy_revision: 'unknown'
      },
      {
        service: 'control-tower',
        app_name: process.env.CONTROL_TOWER_APP_NAME ?? 'control-tower-staging',
        revision: 'unknown',
        environment: 'staging',
        health_verification: 'unknown',
        rollback_eligible: false,
        last_known_healthy_revision: 'unknown'
      }
    ],
    database: {
      host: process.env.CONTROL_TOWER_DATABASE_HOST ?? null,
      port: Number.parseInt(process.env.CONTROL_TOWER_DATABASE_PORT ?? '5432', 10),
      migration_version: process.env.CONTROL_TOWER_DATABASE_MIGRATION_VERSION ?? null,
      expected_tables: [
        'claims',
        'claim_ledgers',
        'revenue_snapshots',
        'era_imports',
        'documents'
      ]
    },
    command_webhooks: readJsonEnv('CONTROL_TOWER_COMMAND_WEBHOOKS_JSON', {}),
    environment_profiles: {
      staging: {
        ui_min_replicas: 0,
        backend_min_replicas: 0,
        control_tower_min_replicas: 1
      },
      production: {
        ui_min_replicas: 1,
        backend_min_replicas: 1,
        control_tower_min_replicas: 1
      }
    }
  };
}

function mergeNamedDefaults(defaultItems, overrides = []) {
  const overrideMap = new Map(overrides.map((item) => [item.component_id, item]));
  return defaultItems.map((item) => ({
    ...item,
    ...(overrideMap.get(item.component_id) ?? {}),
    metadata: {
      ...(item.metadata ?? {}),
      ...((overrideMap.get(item.component_id) ?? {}).metadata ?? {})
    }
  }));
}

export function loadConfig() {
  const defaults = defaultPlatformConfig();
  const override = readJsonEnv('CONTROL_TOWER_PLATFORM_CONFIG_JSON', {});

  return {
    ...defaults,
    ...override,
    services: mergeNamedDefaults(defaults.services, override.services),
    workers: mergeNamedDefaults(defaults.workers, override.workers),
    pipelines: mergeNamedDefaults(defaults.pipelines, override.pipelines),
    infrastructure: mergeNamedDefaults(defaults.infrastructure, override.infrastructure),
    deployments: override.deployments ?? defaults.deployments,
    database: {
      ...defaults.database,
      ...(override.database ?? {})
    },
    command_webhooks: {
      ...defaults.command_webhooks,
      ...(override.command_webhooks ?? {})
    },
    environment_profiles: {
      ...defaults.environment_profiles,
      ...(override.environment_profiles ?? {})
    },
    parsing: {
      azure: readJsonEnv('CONTROL_TOWER_AZURE_SNAPSHOT_JSON', {}),
      runtime: readJsonEnv('CONTROL_TOWER_RUNTIME_SNAPSHOT_JSON', {}),
      database: readJsonEnv('CONTROL_TOWER_DATABASE_SNAPSHOT_JSON', {})
    }
  };
}

export function createControlTowerHealth() {
  return {
    component_id: 'control-tower',
    component_type: COMPONENT_TYPES.SERVICE,
    status: STATUSES.HEALTHY,
    severity: SEVERITIES.INFO,
    message: 'Control Tower API is serving requests.',
    recommended_action: 'Use /api/control/overview for platform status.',
    metadata: {
      capabilities: ['health-model', 'incident-engine', 'command-bus', 'event-stream', 'operator-dashboard']
    }
  };
}
