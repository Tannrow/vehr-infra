import http from 'node:http';
import { renderDashboardHtml } from './dashboard.js';
import { ControlPlaneService } from './control-plane.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const service = new ControlPlaneService();

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body, null, 2));
}

function notFound(response) {
  json(response, 404, { error: 'Not found' });
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    request.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderDashboardHtml());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, {
      status: 'ok',
      service: 'vehr-control-tower',
      generated_at: new Date().toISOString()
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/overview') {
    json(response, 200, await service.getOverview());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/health') {
    json(response, 200, await service.getHealth());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/services') {
    json(response, 200, await service.getSnapshotSection('services'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/workers') {
    json(response, 200, await service.getSnapshotSection('workers'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/pipelines') {
    json(response, 200, await service.getSnapshotSection('pipelines'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/incidents') {
    json(response, 200, await service.getSnapshotSection('incidents'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/alerts') {
    json(response, 200, await service.getSnapshotSection('alerts'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/deployments') {
    const deployments = await service.getSnapshotSection('deployments');
    const snapshot = await service.ensureSnapshot();
    json(response, 200, {
      deployments,
      environment_differences: snapshot.environment_differences
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/metrics') {
    json(response, 200, await service.getSnapshotSection('metrics'));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/control/events/stream') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });

    response.write('retry: 5000\n\n');
    const push = (event) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      push({ type: 'heartbeat', timestamp: new Date().toISOString() });
    }, 15000);

    service.eventEmitter.on('event', push);
    const overview = await service.getOverview();
    push({ type: 'snapshot.ready', timestamp: new Date().toISOString(), overview });

    request.on('close', () => {
      clearInterval(heartbeat);
      service.eventEmitter.off('event', push);
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/control/commands/validate') {
    const body = await parseBody(request);
    json(response, 200, await service.validateCommand(body));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/control/commands/run') {
    const body = await parseBody(request);
    json(response, 200, await service.runCommand(body));
    return;
  }

  const acknowledgeMatch = url.pathname.match(/^\/api\/control\/alerts\/([^/]+)\/acknowledge$/);
  if (request.method === 'POST' && acknowledgeMatch) {
    const body = await parseBody(request);
    const alert = await service.acknowledgeAlert(`alert:${acknowledgeMatch[1].replace(/^alert:/, '')}`, body.operator);
    if (!alert) {
      notFound(response);
      return;
    }
    json(response, 200, alert);
    return;
  }

  const resolveMatch = url.pathname.match(/^\/api\/control\/incidents\/([^/]+)\/resolve$/);
  if (request.method === 'POST' && resolveMatch) {
    const body = await parseBody(request);
    const incident = await service.resolveIncident(`incident:${resolveMatch[1].replace(/^incident:/, '')}`, body.operator, body.notes ?? '');
    if (!incident) {
      notFound(response);
      return;
    }
    json(response, 200, incident);
    return;
  }

  notFound(response);
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    json(response, 500, {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  });
});

server.listen(port, () => {
  console.log(`VEHR Control Tower listening on http://0.0.0.0:${port}`);
});
