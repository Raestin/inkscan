'use strict';
// Resolve only this job's disposable service, never an environment-provided URL.
// Internal Docker bridges permit host access directly to container addresses:
// https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode---internal
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {isIPv4} = require('node:net');
const REST_IMAGE = 'postgrest/postgrest:v16.5@sha256:1347d7552b88f17832912c06afbf7c43209af6eeeb60834b04aae12c9bd9d5cc';
const LOCAL_DOCKER = ['--host', 'unix:///var/run/docker.sock'];

function names() {
  const run = process.env.GITHUB_RUN_ID || 'local';
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  assert(/^(?:local|[1-9][0-9]*)$/.test(run), 'Invalid synthetic QA run identifier');
  assert(/^[1-9][0-9]*$/.test(attempt), 'Invalid synthetic QA run attempt');
  const suffix = `${run}-${attempt}`;
  return {suffix, rest: `inkscan-rest-${suffix}`, pg: `inkscan-pg-${suffix}`, net: `inkscan-qa-${suffix}`};
}

function inspect(kind, target) {
  const records = JSON.parse(execFileSync('docker', [...LOCAL_DOCKER, kind, 'inspect', target], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  assert(Array.isArray(records) && records.length === 1, 'Expected exactly one local Docker object');
  return records[0];
}

function validateEndpoint(container, network, image) {
  const expected = names();
  assert.equal(container.Name, '/' + expected.rest, 'Unexpected QA container');
  assert.equal(container.State?.Running, true, 'QA container is not running');
  assert.equal(container.Config?.Image, REST_IMAGE, 'Unexpected PostgREST image reference');
  assert.equal(container.Image, image.Id, 'Container does not use the pinned image');
  assert(image.RepoDigests?.includes(REST_IMAGE.replace(':v16.5', '')), 'Pinned image digest is not present');
  assert.equal(container.Config?.Labels?.['inkscan.qa.disposable'], expected.suffix, 'Missing disposable-container label');
  assert.equal(network.Name, expected.net, 'Unexpected QA network');
  assert.equal(network.Driver, 'bridge', 'QA network must be a bridge');
  assert.equal(network.Scope, 'local', 'QA network must be local');
  assert.equal(network.Internal, true, 'QA network must remain externally isolated');
  assert.equal(network.Labels?.['inkscan.qa.disposable'], expected.suffix, 'Missing disposable-network label');
  assert.equal(container.HostConfig?.NetworkMode, expected.net, 'Unexpected container network mode');
  assert.deepEqual(Object.keys(container.NetworkSettings?.Networks || {}), [expected.net], 'Container must have only the isolated QA network');
  assert(Object.values(container.HostConfig?.PortBindings || {}).every(value => !value?.length), 'QA service must not publish host ports');
  const endpoint = container.NetworkSettings.Networks[expected.net];
  assert.equal(endpoint.NetworkID, network.Id, 'Container is not attached to the inspected network');
  const member = network.Containers?.[container.Id];
  assert.equal(member?.Name, expected.rest, 'Network does not identify the expected container');
  const members = Object.values(network.Containers || {}).map(value => value.Name).sort();
  assert.deepEqual(members, [expected.pg, expected.rest].sort(), 'Unexpected container on the QA network');
  const ip = endpoint.IPAddress;
  assert(isIPv4(ip), 'Expected a local IPv4 container address');
  const [a, b] = ip.split('.').map(Number);
  assert(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168), 'Container address must be private');
  assert.equal(member.IPv4Address?.split('/')[0], ip, 'Network and container addresses disagree');
  assert.notEqual(endpoint.Gateway, ip, 'Refusing the host gateway address');
  assert(container.Config.Env?.includes(`PGRST_DB_URI=postgres://qa_authenticator:synthetic-local-only@${expected.pg}:5432/postgres`), 'PostgREST must target the synthetic database');
  return `http://${ip}:3000`;
}

function getLocalEndpoint() {
  const expected = names();
  return validateEndpoint(inspect('container', expected.rest), inspect('network', expected.net), inspect('image', REST_IMAGE));
}

module.exports = {getLocalEndpoint, validateEndpoint};
if (require.main === module) {
  try { process.stdout.write(getLocalEndpoint() + '\n'); }
  catch (error) { console.error('Refusing an unverified QA endpoint:', error.message); process.exitCode = 1; }
}
