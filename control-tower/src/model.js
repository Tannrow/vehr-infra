export const COMPONENT_TYPES = {
  SERVICE: 'service',
  WORKER: 'worker',
  PIPELINE: 'pipeline',
  INFRASTRUCTURE: 'infrastructure'
};

export const STATUSES = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  FAILED: 'failed',
  RUNNING: 'running',
  IDLE: 'idle',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown'
};

export const SEVERITIES = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL'
};

export const COMMAND_TYPES = [
  'trigger_revenue_snapshot',
  'retry_era_pipeline',
  'reprocess_claim_batch',
  'refresh_service_health',
  'restart_worker',
  'run_system_diagnostics',
  'validate_deployment_state'
];

const statusToSeverity = {
  [STATUSES.HEALTHY]: SEVERITIES.INFO,
  [STATUSES.RUNNING]: SEVERITIES.INFO,
  [STATUSES.IDLE]: SEVERITIES.INFO,
  [STATUSES.DEGRADED]: SEVERITIES.WARNING,
  [STATUSES.BLOCKED]: SEVERITIES.CRITICAL,
  [STATUSES.FAILED]: SEVERITIES.CRITICAL,
  [STATUSES.UNKNOWN]: SEVERITIES.WARNING
};

export function statusSeverity(status, fallback = SEVERITIES.INFO) {
  return statusToSeverity[status] ?? fallback;
}

export function normalizeComponent(component) {
  const now = new Date().toISOString();
  return {
    component_id: component.component_id,
    component_type: component.component_type,
    status: component.status ?? STATUSES.UNKNOWN,
    severity: component.severity ?? statusSeverity(component.status ?? STATUSES.UNKNOWN),
    last_heartbeat_at: component.last_heartbeat_at ?? now,
    last_success_at: component.last_success_at ?? null,
    last_failure_at: component.last_failure_at ?? null,
    message: component.message ?? 'No telemetry received.',
    metadata: component.metadata ?? {},
    recommended_action: component.recommended_action ?? 'Inspect component telemetry and refresh diagnostics.'
  };
}

export function toIsoString(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function inferSeverity(status, explicitSeverity) {
  return explicitSeverity ?? statusSeverity(status ?? STATUSES.UNKNOWN, SEVERITIES.WARNING);
}
