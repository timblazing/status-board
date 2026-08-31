import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { parseConfig } from './config.ts';
import { Monitor } from './monitor.ts';

async function startServer(status: number, delayMs = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    const send = () => {
      response.statusCode = status;
      response.end();
    };
    if (delayMs) setTimeout(send, delayMs);
    else send();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}/health` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for the monitor state');
}

function configFor(url: string, serviceOptions = '') {
  return parseConfig(`
history_size: 3
check_interval: 1
services:
  - name: API
    url: ${url}
${serviceOptions}`);
}

test('starts with a pending service and the correct aggregate total', async () => {
  const { server, url } = await startServer(200);
  const monitor = new Monitor(configFor(url));

  try {
    const snapshot = monitor.snapshot();
    assert.equal(snapshot.services[0].state, 'pending');
    assert.equal(snapshot.services[0].uptimePct, null);
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.healthy, 0);
  } finally {
    monitor.stop();
    await closeServer(server);
  }
});

test('marks a 2xx response operational and records a healthy history slot', async () => {
  const { server, url } = await startServer(204);
  const monitor = new Monitor(configFor(url));

  try {
    monitor.start();
    await waitFor(() => monitor.snapshot().services[0].state === 'operational');

    const snapshot = monitor.snapshot();
    assert.equal(snapshot.healthy, 1);
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.services[0].history, '--o');
  } finally {
    monitor.stop();
    await closeServer(server);
  }
});

test('marks a non-expected status down and records a failed history slot', async () => {
  const { server, url } = await startServer(500);
  const monitor = new Monitor(configFor(url));

  try {
    monitor.start();
    await waitFor(() => monitor.snapshot().services[0].state === 'down');

    const snapshot = monitor.snapshot();
    assert.equal(snapshot.healthy, 0);
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.services[0].history, '--x');
  } finally {
    monitor.stop();
    await closeServer(server);
  }
});

test('marks a slow successful response degraded without counting it as healthy', async () => {
  const { server, url } = await startServer(200, 40);
  const monitor = new Monitor(configFor(url, '    degraded_threshold_ms: 5\n'));

  try {
    monitor.start();
    await waitFor(() => monitor.snapshot().services[0].state === 'degraded');

    const snapshot = monitor.snapshot();
    assert.equal(snapshot.healthy, 0);
    assert.equal(snapshot.services[0].history, '--d');
  } finally {
    monitor.stop();
    await closeServer(server);
  }
});
