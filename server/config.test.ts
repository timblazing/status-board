import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigError, parseConfig } from './config.ts';

const service = (name = 'API', url = 'http://localhost:3000/health') => `
services:
  - name: ${name}
    url: ${url}
`;

test('applies defaults to a minimal valid configuration', () => {
  const config = parseConfig(service());

  assert.equal(config.title, 'Status');
  assert.equal(config.checkInterval, 60);
  assert.equal(config.refreshInterval, 30);
  assert.equal(config.historySize, 30);
  assert.equal(config.services[0].timeout, 10_000);
  assert.equal(config.services[0].expectedStatus, null);
  assert.deepEqual(config.show, { description: true, bars: true, timeLabels: true });
});

test('rejects a fractional history size as a ConfigError', () => {
  assert.throws(
    () => parseConfig(`
history_size: 1.5
${service()}`),
    (error) =>
      error instanceof ConfigError &&
      !(error instanceof RangeError) &&
      /history_size.*integer/.test(error.message),
  );
});

test('rejects a fractional port as a ConfigError', () => {
  assert.throws(
    () => parseConfig(`
port: 8080.5
${service()}`),
    (error) =>
      error instanceof ConfigError && !(error instanceof RangeError) && /port.*integer/.test(error.message),
  );
});

test('accepts integer port and history size values', () => {
  const config = parseConfig(`
port: 9090
history_size: 5
${service()}`);

  assert.equal(config.port, 9090);
  assert.equal(config.historySize, 5);
});

test('preserves fractional duration and threshold values', () => {
  const config = parseConfig(`
check_interval: 1.5
refresh_interval: 2.5
degraded_threshold_ms: 10.5
services:
  - name: API
    url: http://localhost:3000/health
    timeout: 100.5
`);

  assert.equal(config.checkInterval, 1.5);
  assert.equal(config.refreshInterval, 2.5);
  assert.equal(config.degradedThresholdMs, 10.5);
  assert.equal(config.services[0].timeout, 100.5);
});

test('preserves a trimmed service name, description, and expected statuses', () => {
  const config = parseConfig(`
services:
  - name: '  API  '
    url: http://localhost:3000/health
    description: '  Primary API  '
    expected_status: [200, 204]
`);

  assert.equal(config.services[0].name, 'API');
  assert.equal(config.services[0].description, 'Primary API');
  assert.deepEqual(config.services[0].expectedStatus, [200, 204]);
});

test('rejects an invalid URL scheme', () => {
  assert.throws(
    () => parseConfig(service('API', 'ftp://localhost/file')),
    (error) => error instanceof ConfigError && /http:\/\/ or https:\/\//.test(error.message),
  );
});

test('rejects a service without a name', () => {
  assert.throws(
    () => parseConfig(`
services:
  - url: http://localhost:3000/health
`),
    (error) => error instanceof ConfigError && /missing a name/.test(error.message),
  );
});

test('rejects duplicate service names', () => {
  assert.throws(
    () => parseConfig(`
services:
  - name: API
    url: http://localhost:3000/one
  - name: ' API '
    url: http://localhost:3000/two
`),
    (error) => error instanceof ConfigError && /duplicate service name/.test(error.message),
  );
});

test('rejects a group that references an unknown service', () => {
  assert.throws(
    () => parseConfig(`
services:
  - name: API
    url: http://localhost:3000/health
groups:
  - name: Core
    services: [API, Missing]
`),
    (error) => error instanceof ConfigError && /references unknown service/.test(error.message),
  );
});

test('preserves grouped service names', () => {
  const config = parseConfig(`
services:
  - name: API
    url: http://localhost:3000/api
  - name: Web
    url: http://localhost:3000/web
groups:
  - name: Core
    services: [API, Web]
`);

  assert.deepEqual(config.groups, [{ name: 'Core', services: ['API', 'Web'] }]);
});
