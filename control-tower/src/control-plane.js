import { EventEmitter } from 'node:events';
import { loadConfig, createControlTowerHealth } from './config.js';
import { AzureOperationsAdapter, DatabaseAdapter, RuntimeSnapshotAdapter, ServiceProbeAdapter, WebhookCommandExecutor } from './adapters.js';
import { COMMAND_TYPES, COMPONENT_TYPES, SEVERITIES, STATUSES, normalizeComponent, inferSeverity } from './model.js';

function sortByPriority(items) {
  const statusRank = {
    [STATUSES.FAILED]: 0,
    [STATUSES.BLOCKED]: 1,
    [STATUSES.DEGRADED]: 2,
    [STATUSES.UNKNOWN]: 3,
    [STATUSES.RUNNING]: 4,
    [STATUSES.IDLE]: 5,
    [STATUSES.HEALTHY]: 6
  };

  return [...items].sort((left, right) => {
    const leftRank = statusRank[left.status] ?? 99;
    const rightRank = statusRank[right.status] ?? 99;
    return leftRank - rightRank || left.component_id.localeCompare(right.component_id);
  });
}

function buildAlert(component) {
  return {
    id: `alert:${component.component_id}`,
    title: `${component.component_type} ${component.component_id} is ${component.status}`,
    severity: component.severity,
    status: 'open',
    component_id: component.component_id,
    component_type: component.component_type,
    message: component.message,
    recommended_action: component.recommended_action,
    detected_at: component.last_failure_at ?? component.last_heartbeat_at,
    acknowledged_at: null,
    acknowledged_by: null,
    metadata: component.metadata
  };
}

function buildIncident(component, alert) {
  return {
    id: `incident:${component.component_id}`,
    title: `${component.component_type} incident: ${component.component_id}`,
    affected_components: [component.component_id],
    detected_at: component.last_failure_at ?? component.last_heartbeat_at,
    status: 'open',
    severity: component.severity,
    root_cause_hint: component.message,
    suggested_operator_actions: [component.recommended_action],
    linked_alerts: [alert.id],
    linked_events: []
  };
}

function pickSafeCommands(snapshot) {
  const commands = [];

  if (snapshot.pipelines.some((pipeline) => pipeline.component_id === 'revenue-snapshot-generation' && pipeline.status !== STATUSES.HEALTHY)) {
    commands.push({ type: 'trigger_revenue_snapshot', reason: 'Revenue snapshot pipeline is not healthy.' });
  }

  if (snapshot.pipelines.some((pipeline) => pipeline.component_id === 'era-import-parsing' && pipeline.status !== STATUSES.HEALTHY)) {
    commands.push({ type: 'retry_era_pipeline', reason: 'ERA pipeline requires a safe retry path.' });
  }

  if (snapshot.services.some((service) => service.status !== STATUSES.HEALTHY)) {
    commands.push({ type: 'refresh_service_health', reason: 'At least one service probe is degraded or failed.' });
  }

  commands.push({ type: 'run_system_diagnostics', reason: 'Refresh the full diagnostic graph before higher-risk actions.' });
  commands.push({ type: 'validate_deployment_state', reason: 'Deployment validation is safe and non-invasive.' });

  return commands;
}

function summarizeMetrics(components) {
  const counts = components.reduce((summary, component) => {
    summary.by_status[component.status] = (summary.by_status[component.status] ?? 0) + 1;
    summary.by_severity[component.severity] = (summary.by_severity[component.severity] ?? 0) + 1;
    return summary;
  }, {
    total_components: components.length,
    by_status: {},
    by_severity: {}
  });

  const serviceLatencies = components
    .filter((component) => component.component_type === COMPONENT_TYPES.SERVICE)
    .map((component) => component.metadata.latency_ms)
    .filter((value) => typeof value === 'number');

  const average_latency_ms = serviceLatencies.length > 0
    ? Math.round(serviceLatencies.reduce((sum, value) => sum + value, 0) / serviceLatencies.length)
    : null;

  const error_rate = components
    .filter((component) => component.component_type === COMPONENT_TYPES.SERVICE)
    .map((component) => component.metadata.error_rate)
    .filter((value) => typeof value === 'number');

  return {
    ...counts,
    average_service_latency_ms: average_latency_ms,
    average_service_error_rate: error_rate.length > 0
      ? Number((error_rate.reduce((sum, value) => sum + value, 0) / error_rate.length).toFixed(2))
      : null
  };
}

function latestChanges(events) {
  return [...events].slice(-10).reverse();
}

function buildOverview(snapshot) {
  const broken = sortByPriority(snapshot.components.filter((component) => [STATUSES.FAILED, STATUSES.BLOCKED].includes(component.status)));
  const degraded = sortByPriority(snapshot.components.filter((component) => component.status === STATUSES.DEGRADED || component.status === STATUSES.UNKNOWN));
  const needsAction = [...broken, ...degraded].slice(0, 5);

  return {
    environment: snapshot.environment,
    generated_at: snapshot.generated_at,
    what_is_broken_right_now: broken.map((component) => ({
      component_id: component.component_id,
      component_type: component.component_type,
      status: component.status,
      severity: component.severity,
      message: component.message,
      recommended_action: component.recommended_action
    })),
    what_is_degraded_right_now: degraded.map((component) => ({
      component_id: component.component_id,
      component_type: component.component_type,
      status: component.status,
      severity: component.severity,
      message: component.message,
      recommended_action: component.recommended_action
    })),
    what_changed_recently: latestChanges(snapshot.events),
    what_needs_action_first: needsAction.map((component) => ({
      component_id: component.component_id,
      message: component.message,
      recommended_action: component.recommended_action
    })),
    safe_commands_to_run_next: pickSafeCommands(snapshot),
    ai_operator_context: {
      broken_component_count: broken.length,
      degraded_component_count: degraded.length,
      deployment_changes: snapshot.deployments.map((deployment) => ({
        service: deployment.service,
        revision: deployment.revision,
        health_verification: deployment.health_verification,
        rollback_eligible: deployment.rollback_eligible
      }))
    }
  };
}

export class ControlPlaneService {
  constructor(options = {}) {
    this.configLoader = options.configLoader ?? loadConfig;
    this.events = [];
    this.eventEmitter = new EventEmitter();
    this.alertAcknowledgements = new Map();
    this.incidentResolutions = new Map();
    this.auditLog = [];
    this.serviceProbeAdapter = options.serviceProbeAdapter ?? new ServiceProbeAdapter();
    this.runtimeSnapshotAdapter = options.runtimeSnapshotAdapter ?? null;
    this.azureOperationsAdapter = options.azureOperationsAdapter ?? null;
    this.databaseAdapter = options.databaseAdapter ?? null;
    this.commandExecutor = options.commandExecutor ?? null;
    this.snapshot = null;
  }

  async refresh(reason = 'manual-refresh') {
    const config = this.configLoader();
    const runtimeAdapter = this.runtimeSnapshotAdapter ?? new RuntimeSnapshotAdapter(config.parsing.runtime);
    const azureAdapter = this.azureOperationsAdapter ?? new AzureOperationsAdapter({ snapshot: config.parsing.azure });
    const databaseAdapter = this.databaseAdapter ?? new DatabaseAdapter(config.parsing.database);
    const commandExecutor = this.commandExecutor ?? new WebhookCommandExecutor(config.command_webhooks);
    this.commandExecutor = commandExecutor;

    const [serviceStatusMap, runtimeState, azureState, databaseState] = await Promise.all([
      this.serviceProbeAdapter.collect(config.services),
      runtimeAdapter.collect(config),
      azureAdapter.collect(config),
      databaseAdapter.collect(config)
    ]);

    const services = config.services.map((service) => normalizeComponent({
      ...service,
      ...serviceStatusMap.get(service.component_id),
      component_type: COMPONENT_TYPES.SERVICE,
      last_heartbeat_at: serviceStatusMap.get(service.component_id)?.last_heartbeat_at,
      last_success_at: serviceStatusMap.get(service.component_id)?.last_success_at,
      last_failure_at: serviceStatusMap.get(service.component_id)?.last_failure_at
    }));

    const databaseServiceIndex = services.findIndex((service) => service.component_id === 'postgresql-connectivity');
    if (databaseServiceIndex >= 0) {
      services[databaseServiceIndex] = normalizeComponent({
        ...services[databaseServiceIndex],
        ...databaseState.serviceOverride,
        component_type: COMPONENT_TYPES.SERVICE
      });
    }

    const workers = config.workers.map((worker) => normalizeComponent({
      ...worker,
      ...(runtimeState.workers.get(worker.component_id) ?? {}),
      component_type: COMPONENT_TYPES.WORKER
    }));

    const pipelines = config.pipelines.map((pipeline) => normalizeComponent({
      ...pipeline,
      ...(runtimeState.pipelines.get(pipeline.component_id) ?? {}),
      component_type: COMPONENT_TYPES.PIPELINE
    }));

    const infrastructureMap = new Map();
    for (const base of config.infrastructure) {
      infrastructureMap.set(base.component_id, base);
    }
    for (const incoming of [...(azureState.infrastructure ?? []), ...(databaseState.infrastructure ?? [])]) {
      infrastructureMap.set(incoming.component_id, {
        ...(infrastructureMap.get(incoming.component_id) ?? {}),
        ...incoming,
        component_type: COMPONENT_TYPES.INFRASTRUCTURE
      });
    }

    const infrastructure = [...infrastructureMap.values()].map((component) => normalizeComponent({
      ...component,
      component_type: COMPONENT_TYPES.INFRASTRUCTURE
    }));

    const components = sortByPriority([
      ...services,
      ...workers,
      ...pipelines,
      ...infrastructure,
      normalizeComponent(createControlTowerHealth())
    ]);

    const alerts = components
      .filter((component) => component.severity !== SEVERITIES.INFO)
      .map((component) => {
        const alert = buildAlert(component);
        const acknowledgement = this.alertAcknowledgements.get(alert.id);
        return {
          ...alert,
          status: acknowledgement ? 'acknowledged' : 'open',
          acknowledged_at: acknowledgement?.acknowledged_at ?? null,
          acknowledged_by: acknowledgement?.operator ?? null
        };
      });

    const incidents = alerts
      .filter((alert) => alert.severity === SEVERITIES.CRITICAL)
      .map((alert) => {
        const component = components.find((candidate) => candidate.component_id === alert.component_id);
        const incident = buildIncident(component, alert);
        const resolution = this.incidentResolutions.get(incident.id);
        return {
          ...incident,
          status: resolution ? 'resolved' : 'open',
          resolved_at: resolution?.resolved_at ?? null,
          resolved_by: resolution?.operator ?? null,
          resolution_notes: resolution?.notes ?? null
        };
      });

    const generated_at = new Date().toISOString();
    const snapshot = {
      environment: config.environment,
      generated_at,
      reason,
      services,
      workers,
      pipelines,
      infrastructure,
      components,
      alerts,
      incidents,
      deployments: azureState.deployments ?? config.deployments,
      metrics: summarizeMetrics(components),
      events: this.events,
      audit_log: this.auditLog,
      environment_differences: this.compareEnvironments(config.environment_profiles)
    };

    const previousSnapshot = this.snapshot;
    this.snapshot = snapshot;
    this.emitDiffEvents(previousSnapshot, snapshot, reason);
    return snapshot;
  }

  compareEnvironments(environmentProfiles) {
    const staging = environmentProfiles.staging ?? {};
    const production = environmentProfiles.production ?? {};
    return Object.keys({ ...staging, ...production }).map((key) => ({
      setting: key,
      staging: staging[key] ?? null,
      production: production[key] ?? null,
      different: staging[key] !== production[key]
    })).filter((entry) => entry.different);
  }

  emitDiffEvents(previousSnapshot, nextSnapshot, reason) {
    const previousComponents = new Map((previousSnapshot?.components ?? []).map((component) => [component.component_id, component]));

    for (const component of nextSnapshot.components) {
      const previous = previousComponents.get(component.component_id);
      if (!previous || previous.status !== component.status || previous.message !== component.message) {
        const eventType = this.classifyEvent(component);
        this.publishEvent({
          type: eventType,
          timestamp: nextSnapshot.generated_at,
          reason,
          component_id: component.component_id,
          component_type: component.component_type,
          from_status: previous?.status ?? null,
          to_status: component.status,
          severity: component.severity,
          message: component.message
        });
      }
    }
  }

  classifyEvent(component) {
    if (component.component_type === COMPONENT_TYPES.SERVICE) {
      return 'service.status.changed';
    }
    if (component.component_type === COMPONENT_TYPES.WORKER && component.severity === SEVERITIES.CRITICAL) {
      return 'worker.failure';
    }
    if (component.component_type === COMPONENT_TYPES.PIPELINE && component.severity !== SEVERITIES.INFO) {
      return 'pipeline.failure';
    }
    if (component.component_type === COMPONENT_TYPES.INFRASTRUCTURE && component.component_id === 'deployment-state') {
      return 'deployment.transition';
    }
    return 'platform.signal';
  }

  publishEvent(event) {
    this.events.push(event);
    if (this.events.length > 100) {
      this.events.shift();
    }
    this.eventEmitter.emit('event', event);
  }

  async ensureSnapshot() {
    if (!this.snapshot) {
      await this.refresh('initial-load');
    }
    return this.snapshot;
  }

  async getOverview() {
    const snapshot = await this.ensureSnapshot();
    return buildOverview(snapshot);
  }

  async getHealth() {
    const snapshot = await this.ensureSnapshot();
    return {
      schema_version: '2026-03-10',
      generated_at: snapshot.generated_at,
      environment: snapshot.environment,
      components: snapshot.components
    };
  }

  async validateCommand(command) {
    const snapshot = await this.ensureSnapshot();
    const definition = this.describeCommand(command.type);
    const issues = [];

    if (!COMMAND_TYPES.includes(command.type)) {
      issues.push(`Unsupported command type: ${command.type}`);
    }

    if (!command.operator) {
      issues.push('operator is required for audit attribution');
    }

    if (command.type === 'restart_worker' && !command.payload?.worker_id) {
      issues.push('payload.worker_id is required when restarting a worker');
    }

    if (command.type === 'reprocess_claim_batch' && !command.payload?.batch_id) {
      issues.push('payload.batch_id is required when reprocessing a claim batch');
    }

    const affected = this.inferAffectedComponents(command, snapshot);
    const safe = affected.every((component) => component.severity !== SEVERITIES.CRITICAL || command.type === 'run_system_diagnostics');

    return {
      valid: issues.length === 0,
      safe_to_run: issues.length === 0 && safe,
      dry_run_supported: true,
      issues,
      affected_components: affected.map((component) => component.component_id),
      recommendation: issues.length > 0
        ? 'Fix validation issues before running the command.'
        : safe
          ? definition.safe_message
          : 'Run system diagnostics first; the target component is already in a critical state.',
      command: {
        ...command,
        dry_run: command.dry_run ?? false
      }
    };
  }

  describeCommand(type) {
    const descriptions = {
      trigger_revenue_snapshot: { safe_message: 'Safe when the database schema is healthy and the snapshot pipeline is not blocked.' },
      retry_era_pipeline: { safe_message: 'Safe after validating storage/document service reachability.' },
      reprocess_claim_batch: { safe_message: 'Safe for targeted batch replay when operator provided a batch_id.' },
      refresh_service_health: { safe_message: 'Safe and read-only.' },
      restart_worker: { safe_message: 'Safe when the worker backlog is preserved and operator selected the worker.' },
      run_system_diagnostics: { safe_message: 'Always safe; this command only refreshes diagnostics.' },
      validate_deployment_state: { safe_message: 'Safe and read-only.' }
    };

    return descriptions[type] ?? { safe_message: 'Review the command plan before execution.' };
  }

  inferAffectedComponents(command, snapshot) {
    if (command.type === 'restart_worker') {
      return snapshot.components.filter((component) => component.component_id === command.payload?.worker_id);
    }

    if (command.type === 'trigger_revenue_snapshot') {
      return snapshot.components.filter((component) => ['revenue-snapshot-generation', 'revenue-snapshot-worker', 'postgresql-connectivity'].includes(component.component_id));
    }

    if (command.type === 'retry_era_pipeline') {
      return snapshot.components.filter((component) => ['era-import-parsing', 'era-ingestion-worker'].includes(component.component_id));
    }

    if (command.type === 'reprocess_claim_batch') {
      return snapshot.components.filter((component) => ['claim-ingestion', 'claim-reconciliation', 'claim-reconciliation-worker'].includes(component.component_id));
    }

    return snapshot.components.filter((component) => component.severity !== SEVERITIES.INFO);
  }

  async runCommand(command) {
    const validation = await this.validateCommand(command);
    const auditEntry = {
      id: `audit:${Date.now()}`,
      timestamp: new Date().toISOString(),
      operator: command.operator ?? 'unknown',
      command_type: command.type,
      payload: command.payload ?? {},
      dry_run: command.dry_run ?? false,
      validation
    };

    this.auditLog.push(auditEntry);
    if (this.auditLog.length > 100) {
      this.auditLog.shift();
    }

    if (!validation.valid) {
      this.publishEvent({
        type: 'command.execution.result',
        timestamp: auditEntry.timestamp,
        status: 'validation_failed',
        command_type: command.type,
        operator: auditEntry.operator,
        issues: validation.issues
      });
      return {
        status: 'validation_failed',
        validation,
        audit: auditEntry
      };
    }

    if (command.dry_run) {
      this.publishEvent({
        type: 'command.execution.result',
        timestamp: auditEntry.timestamp,
        status: 'dry_run',
        command_type: command.type,
        operator: auditEntry.operator
      });
      return {
        status: 'dry_run',
        validation,
        audit: auditEntry,
        result: 'Dry run completed successfully.'
      };
    }

    let result;
    if (['refresh_service_health', 'run_system_diagnostics', 'validate_deployment_state'].includes(command.type)) {
      await this.refresh(`command:${command.type}`);
      result = {
        status: 'completed',
        message: 'Diagnostics refreshed.'
      };
    } else {
      result = await this.commandExecutor.execute(command);
      await this.refresh(`command:${command.type}`);
    }

    this.publishEvent({
      type: 'command.execution.result',
      timestamp: new Date().toISOString(),
      status: result.status,
      command_type: command.type,
      operator: auditEntry.operator,
      message: result.message
    });

    return {
      status: result.status,
      validation,
      audit: auditEntry,
      result
    };
  }

  async acknowledgeAlert(id, operator = 'unknown') {
    const snapshot = await this.ensureSnapshot();
    const alert = snapshot.alerts.find((candidate) => candidate.id === id);
    if (!alert) {
      return null;
    }

    const acknowledgement = {
      operator,
      acknowledged_at: new Date().toISOString()
    };
    this.alertAcknowledgements.set(id, acknowledgement);
    this.publishEvent({
      type: 'alert.acknowledged',
      timestamp: acknowledgement.acknowledged_at,
      alert_id: id,
      operator
    });
    await this.refresh('alert-acknowledged');
    return this.snapshot.alerts.find((candidate) => candidate.id === id) ?? null;
  }

  async resolveIncident(id, operator = 'unknown', notes = '') {
    const snapshot = await this.ensureSnapshot();
    const incident = snapshot.incidents.find((candidate) => candidate.id === id);
    if (!incident) {
      return null;
    }

    const resolution = {
      operator,
      notes,
      resolved_at: new Date().toISOString()
    };
    this.incidentResolutions.set(id, resolution);
    this.publishEvent({
      type: 'incident.resolved',
      timestamp: resolution.resolved_at,
      incident_id: id,
      operator,
      notes
    });
    await this.refresh('incident-resolved');
    return this.snapshot.incidents.find((candidate) => candidate.id === id) ?? null;
  }

  async getSnapshotSection(section) {
    const snapshot = await this.ensureSnapshot();
    return snapshot[section];
  }
}
