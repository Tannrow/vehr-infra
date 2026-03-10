import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneService } from '../src/control-plane.js';
import { loadConfig } from '../src/config.js';
import { SEVERITIES, STATUSES } from '../src/model.js';

class StubServiceProbeAdapter {
  async collect() {
    return new Map([
      ['vehr-backend-api', {
        component_id: 'vehr-backend-api',
        status: STATUSES.FAILED,
        severity: SEVERITIES.CRITICAL,
        message: 'Backend health probe failed.',
        metadata: { error_rate: 1, latency_ms: 1200 }
      }],
      ['revenue-ui', {
        component_id: 'revenue-ui',
        status: STATUSES.HEALTHY,
        severity: SEVERITIES.INFO,
        message: 'UI is healthy.',
        metadata: { error_rate: 0, latency_ms: 60 }
      }]
    ]);
  }
}

class StubRuntimeSnapshotAdapter {
  collect() {
    return {
      workers: new Map([
        ['revenue-snapshot-worker', {
          component_id: 'revenue-snapshot-worker',
          status: STATUSES.DEGRADED,
          severity: SEVERITIES.WARNING,
          metadata: { backlog: 42 }
        }]
      ]),
      pipelines: new Map([
        ['revenue-snapshot-generation', {
          component_id: 'revenue-snapshot-generation',
          status: STATUSES.FAILED,
          severity: SEVERITIES.CRITICAL,
          metadata: {
            blocked_stage: 'warehouse-write',
            current_failure_reason: 'claim_ledgers table missing',
            safe_retry_action: 'trigger_revenue_snapshot'
          }
        }]
      ])
    };
  }
}

class StubAzureOperationsAdapter {
  async collect(config) {
    return {
      deployments: config.deployments.map((deployment, index) => ({
        ...deployment,
        revision: `rev-${index + 1}`,
        health_verification: index === 0 ? 'passed' : 'investigate',
        rollback_eligible: true,
        last_known_healthy_revision: `rev-${index}`
      })),
      infrastructure: [
        {
          component_id: 'azure-container-apps',
          status: STATUSES.DEGRADED,
          severity: SEVERITIES.WARNING,
          message: 'One revision is still warming.',
          metadata: { replica_count: 2 }
        }
      ]
    };
  }
}

class StubDatabaseAdapter {
  async collect() {
    return {
      infrastructure: [
        {
          component_id: 'postgresql-runtime',
          status: STATUSES.FAILED,
          severity: SEVERITIES.CRITICAL,
          message: 'Missing critical tables: claim_ledgers.',
          metadata: { missing_tables: ['claim_ledgers'] }
        }
      ],
      serviceOverride: {
        component_id: 'postgresql-connectivity',
        status: STATUSES.FAILED,
        severity: SEVERITIES.CRITICAL,
        message: 'Snapshot worker is failing because claim_ledgers table is missing.',
        recommended_action: 'Restore claim_ledgers before retrying the snapshot worker.',
        metadata: { missing_tables: ['claim_ledgers'] }
      }
    };
  }
}

class StubCommandExecutor {
  async execute(command) {
    return {
      status: 'completed',
      message: `Executed ${command.type}`
    };
  }
}

function createService() {
  return new ControlPlaneService({
    serviceProbeAdapter: new StubServiceProbeAdapter(),
    runtimeSnapshotAdapter: new StubRuntimeSnapshotAdapter(),
    azureOperationsAdapter: new StubAzureOperationsAdapter(),
    databaseAdapter: new StubDatabaseAdapter(),
    commandExecutor: new StubCommandExecutor()
  });
}

test('overview prioritizes broken systems and safe next commands', async () => {
  const service = createService();
  const overview = await service.getOverview();

  assert.equal(overview.what_is_broken_right_now[0].component_id, 'postgresql-connectivity');
  assert.match(JSON.stringify(overview.what_is_broken_right_now), /claim_ledgers/);
  assert.ok(overview.safe_commands_to_run_next.some((command) => command.type === 'trigger_revenue_snapshot'));
  assert.ok(overview.safe_commands_to_run_next.some((command) => command.type === 'run_system_diagnostics'));
});

test('health schema returns canonical normalized components', async () => {
  const service = createService();
  const health = await service.getHealth();
  const backend = health.components.find((component) => component.component_id === 'vehr-backend-api');

  assert.equal(health.schema_version, '2026-03-10');
  assert.equal(backend.component_type, 'service');
  assert.equal(backend.status, 'failed');
  assert.equal(typeof backend.message, 'string');
  assert.ok('recommended_action' in backend);
});

test('command validation and execution enforce operator attribution and auditability', async () => {
  const service = createService();
  const invalid = await service.validateCommand({ type: 'restart_worker', payload: { worker_id: 'era-ingestion-worker' } });
  assert.equal(invalid.valid, false);
  assert.match(invalid.issues.join(' '), /operator/);

  const result = await service.runCommand({
    type: 'run_system_diagnostics',
    operator: 'ops@example.com',
    dry_run: false,
    payload: {}
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.audit.operator, 'ops@example.com');
});

test('default staging deployment app names target the live EUS2 apps', () => {
  const originalRevenueUiAppName = process.env.CONTROL_TOWER_REVENUE_UI_APP_NAME;
  const originalBackendAppName = process.env.CONTROL_TOWER_BACKEND_APP_NAME;

  delete process.env.CONTROL_TOWER_REVENUE_UI_APP_NAME;
  delete process.env.CONTROL_TOWER_BACKEND_APP_NAME;

  try {
    const config = loadConfig();

    assert.equal(
      config.deployments.find((deployment) => deployment.service === 'revenue-ui')?.app_name,
      'vehr-revenue-ui-staging-eus2'
    );
    assert.equal(
      config.deployments.find((deployment) => deployment.service === 'vehr-backend-api')?.app_name,
      'vehr-revos-staging-eus2'
    );
  } finally {
    if (originalRevenueUiAppName === undefined) {
      delete process.env.CONTROL_TOWER_REVENUE_UI_APP_NAME;
    } else {
      process.env.CONTROL_TOWER_REVENUE_UI_APP_NAME = originalRevenueUiAppName;
    }

    if (originalBackendAppName === undefined) {
      delete process.env.CONTROL_TOWER_BACKEND_APP_NAME;
    } else {
      process.env.CONTROL_TOWER_BACKEND_APP_NAME = originalBackendAppName;
    }
  }
});
