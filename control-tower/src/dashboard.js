export function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VEHR Control Tower</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      body { margin: 0; background: #0f172a; color: #e2e8f0; }
      header { padding: 1.5rem 2rem; border-bottom: 1px solid #334155; background: #111827; position: sticky; top: 0; z-index: 10; }
      main { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; padding: 1rem; }
      section { background: #111827; border: 1px solid #334155; border-radius: 16px; padding: 1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.18); }
      h1, h2 { margin: 0 0 0.75rem 0; }
      p { color: #cbd5e1; }
      table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      th, td { text-align: left; border-bottom: 1px solid #1e293b; padding: 0.55rem 0.25rem; vertical-align: top; }
      th { color: #94a3b8; font-weight: 600; }
      .grid-span { grid-column: 1 / -1; }
      .pill { border-radius: 999px; padding: 0.2rem 0.6rem; font-size: 0.8rem; font-weight: 700; display: inline-block; }
      .healthy { background: rgba(22,163,74,.2); color: #86efac; }
      .degraded, .unknown { background: rgba(217,119,6,.2); color: #fdba74; }
      .failed, .blocked { background: rgba(220,38,38,.2); color: #fca5a5; }
      .running, .idle { background: rgba(30,64,175,.2); color: #93c5fd; }
      code { background: #020617; border-radius: 8px; padding: 0.25rem 0.35rem; }
      button, select, input { width: 100%; box-sizing: border-box; border-radius: 10px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; padding: 0.6rem 0.8rem; }
      button { cursor: pointer; }
      .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; }
      .summary-card { background: #020617; border-radius: 12px; padding: 0.85rem; border: 1px solid #1e293b; }
      .event-list, .action-list { display: flex; flex-direction: column; gap: 0.6rem; }
      .event-item { padding: 0.75rem; border-radius: 12px; background: #020617; border: 1px solid #1e293b; }
      .muted { color: #94a3b8; }
      .command-output { white-space: pre-wrap; min-height: 5rem; background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 0.8rem; }
      .stack > * { margin-bottom: 0.75rem; }
      .severity { display: inline-block; min-width: 5rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>VEHR Control Tower</h1>
      <p>Health, diagnostics, and safe operator actions for the VEHR platform.</p>
      <div id="status" class="muted">Loading live platform state…</div>
    </header>
    <main>
      <section>
        <h2>Platform overview</h2>
        <div id="overview-cards" class="summary-grid"></div>
      </section>
      <section>
        <h2>Actionability</h2>
        <div id="priority-actions" class="action-list"></div>
      </section>
      <section class="grid-span">
        <h2>Health</h2>
        <table>
          <thead><tr><th>Component</th><th>Type</th><th>Status</th><th>Severity</th><th>Message</th><th>Recommended action</th></tr></thead>
          <tbody id="health-table"></tbody>
        </table>
      </section>
      <section class="grid-span">
        <h2>Services</h2>
        <table>
          <thead><tr><th>Service</th><th>Status</th><th>Latency</th><th>Error rate</th><th>Health endpoint</th><th>Last known good state</th></tr></thead>
          <tbody id="services-table"></tbody>
        </table>
      </section>
      <section class="grid-span">
        <h2>Workers</h2>
        <table>
          <thead><tr><th>Worker</th><th>Status</th><th>Last run</th><th>Last success</th><th>Last failure</th><th>Backlog</th><th>Recommended action</th></tr></thead>
          <tbody id="workers-table"></tbody>
        </table>
      </section>
      <section class="grid-span">
        <h2>Pipelines</h2>
        <table>
          <thead><tr><th>Pipeline</th><th>Status</th><th>Last success</th><th>Last failure</th><th>Blocked stage</th><th>Failure reason</th><th>Safe retry</th></tr></thead>
          <tbody id="pipelines-table"></tbody>
        </table>
      </section>
      <section>
        <h2>Incidents</h2>
        <div id="incidents-list" class="event-list"></div>
      </section>
      <section>
        <h2>Alerts</h2>
        <div id="alerts-list" class="event-list"></div>
      </section>
      <section class="grid-span">
        <h2>Deployments</h2>
        <table>
          <thead><tr><th>Service</th><th>Revision</th><th>Health verification</th><th>Rollback eligible</th><th>Last healthy revision</th></tr></thead>
          <tbody id="deployments-table"></tbody>
        </table>
      </section>
      <section>
        <h2>Diagnostics</h2>
        <div id="recent-events" class="event-list"></div>
      </section>
      <section>
        <h2>Command console</h2>
        <form id="command-form" class="stack">
          <label>Operator<input id="operator" required placeholder="operator@example.com" /></label>
          <label>Command
            <select id="command-type">
              <option>trigger_revenue_snapshot</option>
              <option>retry_era_pipeline</option>
              <option>reprocess_claim_batch</option>
              <option>refresh_service_health</option>
              <option>restart_worker</option>
              <option>run_system_diagnostics</option>
              <option>validate_deployment_state</option>
            </select>
          </label>
          <label>Payload JSON<input id="payload" placeholder='{"worker_id":"era-ingestion-worker"}' /></label>
          <label><input id="dry-run" type="checkbox" checked style="width:auto" /> Dry run</label>
          <button type="submit">Run command</button>
        </form>
        <div id="command-output" class="command-output">Command results will appear here.</div>
      </section>
    </main>
    <script>
      const statusEl = document.getElementById('status');
      const healthTable = document.getElementById('health-table');
      const servicesTable = document.getElementById('services-table');
      const workersTable = document.getElementById('workers-table');
      const pipelinesTable = document.getElementById('pipelines-table');
      const incidentsList = document.getElementById('incidents-list');
      const alertsList = document.getElementById('alerts-list');
      const deploymentsTable = document.getElementById('deployments-table');
      const recentEvents = document.getElementById('recent-events');
      const overviewCards = document.getElementById('overview-cards');
      const priorityActions = document.getElementById('priority-actions');
      const commandOutput = document.getElementById('command-output');
      const form = document.getElementById('command-form');

      const badge = (status) => '<span class="pill ' + status + '">' + status + '</span>';
      const severityBadge = (severity) => {
        const tone = severity === 'CRITICAL' ? '#b91c1c' : severity === 'WARNING' ? '#d97706' : '#15803d';
        return '<span class="severity" style="background:' + tone + ';color:white;border-radius:999px;padding:0.15rem 0.55rem;font-size:0.75rem;font-weight:700">' + severity + '</span>';
      };

      async function fetchJson(path) {
        const response = await fetch(path);
        if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + path);
        return response.json();
      }

      function renderSummary(overview, metrics) {
        overviewCards.innerHTML = [
          { label: 'Broken now', value: overview.what_is_broken_right_now.length },
          { label: 'Degraded now', value: overview.what_is_degraded_right_now.length },
          { label: 'Components tracked', value: metrics.total_components },
          { label: 'Avg service latency', value: metrics.average_service_latency_ms == null ? 'n/a' : metrics.average_service_latency_ms + ' ms' }
        ].map((card) => '<div class="summary-card"><div class="muted">' + card.label + '</div><div style="font-size:1.8rem;font-weight:800">' + card.value + '</div></div>').join('');

        priorityActions.innerHTML = overview.what_needs_action_first.length
          ? overview.what_needs_action_first.map((item) => '<div class="event-item"><strong>' + item.component_id + '</strong><br>' + item.message + '<br><span class="muted">' + item.recommended_action + '</span></div>').join('')
          : '<div class="event-item">No urgent operator actions required.</div>';
      }

      function renderHealth(components) {
        healthTable.innerHTML = components.map((component) => '<tr><td><strong>' + component.component_id + '</strong></td><td>' + component.component_type + '</td><td>' + badge(component.status) + '</td><td>' + severityBadge(component.severity) + '</td><td>' + component.message + '</td><td>' + component.recommended_action + '</td></tr>').join('');
      }

      function renderServices(services) {
        servicesTable.innerHTML = services.map((service) => '<tr><td><strong>' + service.component_id + '</strong></td><td>' + badge(service.status) + '</td><td>' + (service.metadata.latency_ms ?? 'n/a') + '</td><td>' + (service.metadata.error_rate ?? 'n/a') + '</td><td>' + (service.metadata.health_endpoint_result ?? 'not configured') + '</td><td>' + (service.metadata.last_known_good_state ?? 'n/a') + '</td></tr>').join('');
      }

      function renderWorkers(workers) {
        workersTable.innerHTML = workers.map((worker) => '<tr><td><strong>' + worker.component_id + '</strong></td><td>' + badge(worker.status) + '</td><td>' + (worker.metadata.last_run_at ?? 'n/a') + '</td><td>' + (worker.last_success_at ?? 'n/a') + '</td><td>' + (worker.last_failure_at ?? 'n/a') + '</td><td>' + (worker.metadata.backlog ?? worker.metadata.queue_size ?? 'n/a') + '</td><td>' + worker.recommended_action + '</td></tr>').join('');
      }

      function renderPipelines(pipelines) {
        pipelinesTable.innerHTML = pipelines.map((pipeline) => '<tr><td><strong>' + pipeline.component_id + '</strong></td><td>' + badge(pipeline.status) + '</td><td>' + (pipeline.last_success_at ?? 'n/a') + '</td><td>' + (pipeline.last_failure_at ?? 'n/a') + '</td><td>' + (pipeline.metadata.blocked_stage ?? 'n/a') + '</td><td>' + (pipeline.metadata.current_failure_reason ?? 'n/a') + '</td><td><code>' + (pipeline.metadata.safe_retry_action ?? 'n/a') + '</code></td></tr>').join('');
      }

      function renderEventList(container, items, labelFn) {
        container.innerHTML = items.length ? items.map((item) => '<div class="event-item">' + labelFn(item) + '</div>').join('') : '<div class="event-item">None.</div>';
      }

      function renderDeployments(deployments) {
        deploymentsTable.innerHTML = deployments.map((deployment) => '<tr><td><strong>' + deployment.service + '</strong></td><td>' + (deployment.revision ?? 'unknown') + '</td><td>' + (deployment.health_verification ?? 'unknown') + '</td><td>' + (deployment.rollback_eligible ? 'yes' : 'no') + '</td><td>' + (deployment.last_known_healthy_revision ?? 'unknown') + '</td></tr>').join('');
      }

      async function loadDashboard() {
        const [overview, health, services, workers, pipelines, incidents, alerts, deployments, metrics] = await Promise.all([
          fetchJson('/api/control/overview'),
          fetchJson('/api/control/health'),
          fetchJson('/api/control/services'),
          fetchJson('/api/control/workers'),
          fetchJson('/api/control/pipelines'),
          fetchJson('/api/control/incidents'),
          fetchJson('/api/control/alerts'),
          fetchJson('/api/control/deployments'),
          fetchJson('/api/control/metrics')
        ]);

        statusEl.textContent = 'Live as of ' + overview.generated_at + ' · env: ' + overview.environment;
        renderSummary(overview, metrics);
        renderHealth(health.components);
        renderServices(services);
        renderWorkers(workers);
        renderPipelines(pipelines);
        renderEventList(incidentsList, incidents, (incident) => '<strong>' + incident.title + '</strong><br>' + incident.root_cause_hint + '<br><span class="muted">Actions: ' + incident.suggested_operator_actions.join('; ') + '</span>');
        renderEventList(alertsList, alerts, (alert) => '<strong>' + alert.title + '</strong><br>' + alert.message + '<br><span class="muted">Action: ' + alert.recommended_action + '</span>');
        renderDeployments(deployments.deployments ?? deployments);
        renderEventList(recentEvents, overview.what_changed_recently, (event) => '<strong>' + event.type + '</strong><br>' + (event.component_id ?? 'platform') + ': ' + (event.message ?? '') + '<br><span class="muted">' + event.timestamp + '</span>');
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        let payload = {};
        const rawPayload = document.getElementById('payload').value.trim();
        if (rawPayload) {
          try {
            payload = JSON.parse(rawPayload);
          } catch (error) {
            commandOutput.textContent = 'Invalid payload JSON: ' + error.message;
            return;
          }
        }

        const body = {
          type: document.getElementById('command-type').value,
          operator: document.getElementById('operator').value,
          payload,
          dry_run: document.getElementById('dry-run').checked
        };

        const response = await fetch('/api/control/commands/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const result = await response.json();
        commandOutput.textContent = JSON.stringify(result, null, 2);
        await loadDashboard();
      });

      const eventSource = new EventSource('/api/control/events/stream');
      eventSource.onmessage = () => loadDashboard().catch((error) => {
        statusEl.textContent = 'Live refresh failed: ' + error.message;
      });

      loadDashboard().catch((error) => {
        statusEl.textContent = 'Failed to load dashboard: ' + error.message;
      });
    </script>
  </body>
</html>`;
}
