import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from './server.js';
import { EncryptedStore } from './store.js';
import { CONSENT_VERSION } from './wellness.js';

const now = Date.parse('2026-11-14T10:00:00Z');
const profile = {
  seat: '12A', flightNumber: 'CX797', departure: '2026-11-14T10:00:00Z',
  arrival: '2026-11-14T20:00:00Z', diet: 'vegetarian', allergies: '', herbalOptIn: true
};
const biomarkers = { heartRate: 75, spo2: 98, hydration: 30, stress: 4 };

async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'skyzen-test-'));
  const key = randomBytes(32);
  const crewToken = randomBytes(32).toString('hex');
  let time = now;
  const server = createApp({ key, crewToken, dataDir, clock: () => time });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, cookie, origin } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const consent = extra => ({ consent: true, consentVersion: CONSENT_VERSION, profile, ...extra });
  return { request, base, dataDir, key, crewToken, consent, setTime: value => { time = value; } };
}

test('serves separate dashboards and shared assets without credentials and blocks unknown paths', async t => {
  const { base, crewToken } = await fixture(t);
  for (const path of ['/', '/passenger.html', '/crew.html', '/passenger.js', '/crew.js', '/common.js', '/styles.css']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await response.text()).includes(crewToken), false);
  }
  assert.equal((await fetch(base + '/backend/server.js')).status, 404);
  assert.equal((await fetch(base + '/data/passengers.enc')).status, 404);
});

test('requires explicit consent and independent passenger/crew authentication', async t => {
  const { request, consent, crewToken } = await fixture(t);
  assert.equal((await request('/api/passenger')).status, 401);
  assert.equal((await request('/api/crew/passengers')).status, 401);
  assert.equal((await request('/api/passenger/biomarkers', { method: 'POST', body: biomarkers })).status, 401);
  assert.equal((await request('/api/passengers', { method: 'POST', body: consent({ consent: false }) })).status, 400);
  assert.equal((await request('/api/passengers', { method: 'POST', body: consent({ consentVersion: 'old' }) })).status, 400);
  assert.equal((await request('/api/passengers', { method: 'POST', body: consent(), origin: 'https://untrusted.example' })).status, 403);
  const passenger = await request('/api/passengers', { method: 'POST', body: consent() });
  assert.equal(passenger.status, 201);
  assert.equal(passenger.body.biomarkers, null);
  assert.equal(passenger.body.tokenHash, undefined);
  assert.equal((await request('/api/crew/passengers', { cookie: passenger.cookie })).status, 401);
  assert.equal((await request('/api/passengers', { method: 'POST', body: consent(), cookie: passenger.cookie })).status, 409);
  const crew = await request('/api/crew/login', { method: 'POST', body: { token: crewToken } });
  assert.equal(crew.status, 200);
  assert.equal((await request('/api/passenger', { cookie: crew.cookie })).status, 401);
  await request('/api/crew/logout', { method: 'POST', cookie: crew.cookie });
  assert.equal((await request('/api/crew/passengers', { cookie: crew.cookie })).status, 401);
});

test('live readings reach crew, are encrypted at rest, and consent withdrawal removes data and jobs', async t => {
  const { request, consent, crewToken, dataDir, key } = await fixture(t);
  const passenger = await request('/api/passengers', { method: 'POST', body: consent() });
  const cookie = passenger.cookie;
  assert.equal((await request('/api/passenger/biomarkers', { method: 'POST', cookie, body: { ...biomarkers, spo2: 101 } })).status, 400);
  const updated = await request('/api/passenger/biomarkers', { method: 'POST', cookie, body: biomarkers });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.recommendations.stale, false);
  const crew = await request('/api/crew/login', { method: 'POST', body: { token: crewToken } });
  const live = await request('/api/crew/passengers', { cookie: crew.cookie });
  assert.deepEqual(live.body.passengers[0].biomarkers, biomarkers);
  const payload = readFileSync(join(dataDir, 'passengers.enc'), 'utf8');
  assert.equal(payload.includes('12A'), false);
  assert.equal(payload.includes('heartRate'), false);
  assert.equal(statSync(join(dataDir, 'passengers.enc')).mode & 0o777, 0o600);
  assert.deepEqual(new EncryptedStore(dataDir, key).records[passenger.body.id].biomarkers, biomarkers);
  assert.throws(() => new EncryptedStore(dataDir, randomBytes(32)));
  const deleted = await request('/api/passenger', { method: 'DELETE', cookie });
  assert.equal(deleted.status, 200);
  assert.equal((await request('/api/passenger', { cookie })).status, 401);
  assert.deepEqual((await request('/api/crew/passengers', { cookie: crew.cookie })).body.passengers, []);
  assert.deepEqual(new EncryptedStore(dataDir, key).records, {});
});

test('galley jobs follow meals, require confirmation, avoid collisions and remain simulations', async t => {
  const { request, consent, crewToken } = await fixture(t);
  const passenger = await request('/api/passengers', { method: 'POST', body: consent() });
  const crew = await request('/api/crew/login', { method: 'POST', body: { token: crewToken } });
  const body = {
    passengerId: passenger.body.id, mealId: passenger.body.recommendations.meals[0].id,
    machineId: 'oven-1', temperatureC: 160, durationMinutes: 20, crewConfirmed: true
  };
  const schedule = extra => request('/api/crew/galley', { method: 'POST', cookie: crew.cookie, body: { ...body, ...extra } });
  assert.equal((await schedule({ crewConfirmed: false })).status, 400);
  assert.equal((await schedule({ temperatureC: 300 })).status, 400);
  assert.equal((await schedule({ mealId: 'not-a-meal' })).status, 409);
  const created = await schedule({});
  assert.equal(created.status, 201);
  assert.equal(created.body.simulationOnly, true);
  assert.equal(created.body.job.status, 'simulated');
  assert.equal(created.body.job.startAt, '2026-11-14T10:40:00.000Z');
  assert.equal(created.body.job.serveAt, passenger.body.recommendations.meals[0].at);
  assert.equal((await schedule({})).status, 409);
  const second = await request('/api/passengers', { method: 'POST', body: consent({ profile: { ...profile, seat: '12B' } }) });
  assert.equal((await schedule({ passengerId: second.body.id })).status, 409);
  assert.equal((await schedule({ passengerId: second.body.id, machineId: 'oven-2' })).status, 201);
  await request('/api/crew/galley/cancel', { method: 'POST', cookie: crew.cookie, body: { passengerId: passenger.body.id, jobId: created.body.job.id } });
  assert.equal((await schedule({})).status, 201);
  await request('/api/passenger', { method: 'DELETE', cookie: passenger.cookie });
  assert.equal((await schedule({})).status, 404);
});

test('retention expires records and closes post-arrival updates', async t => {
  const { request, consent, setTime, dataDir, key } = await fixture(t);
  const passenger = await request('/api/passengers', { method: 'POST', body: consent() });
  setTime(Date.parse(profile.arrival));
  assert.equal((await request('/api/passenger/biomarkers', { method: 'POST', cookie: passenger.cookie, body: biomarkers })).status, 409);
  setTime(Date.parse(profile.arrival) + 24 * 60 * 60_000);
  assert.equal((await request('/api/passenger', { cookie: passenger.cookie })).status, 401);
  assert.deepEqual(new EncryptedStore(dataDir, key).records, {});
});

test('encrypted records reject tampering', () => {
  const directory = mkdtempSync(join(tmpdir(), 'skyzen-tamper-'));
  try {
    const key = randomBytes(32);
    const store = new EncryptedStore(directory, key);
    store.records = { example: { value: 'private' } };
    store.save();
    const payload = JSON.parse(readFileSync(store.path, 'utf8'));
    const data = Buffer.from(payload.data, 'base64');
    data[0] ^= 1;
    payload.data = data.toString('base64');
    writeFileSync(store.path, JSON.stringify(payload));
    assert.throws(() => new EncryptedStore(directory, key));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed writes leave readings and consent deletion retryable', async t => {
  const { request, consent, crewToken, dataDir, key } = await fixture(t);
  const passenger = await request('/api/passengers', { method: 'POST', body: consent() });
  const crew = await request('/api/crew/login', { method: 'POST', body: { token: crewToken } });
  const blockedWrite = join(dataDir, 'passengers.enc.tmp');
  mkdirSync(blockedWrite);
  assert.equal((await request('/api/passenger/biomarkers', { method: 'POST', cookie: passenger.cookie, body: biomarkers })).status, 500);
  assert.equal((await request('/api/passenger', { cookie: passenger.cookie })).body.biomarkers, null);
  assert.equal((await request('/api/passenger', { method: 'DELETE', cookie: passenger.cookie })).status, 500);
  assert.equal((await request('/api/passenger', { cookie: passenger.cookie })).status, 200);
  assert.equal((await request('/api/crew/passengers', { cookie: crew.cookie })).body.passengers.length, 1);
  assert.equal(Object.keys(new EncryptedStore(dataDir, key).records).length, 1);
  rmSync(blockedWrite, { recursive: true });
  assert.equal((await request('/api/passenger', { method: 'DELETE', cookie: passenger.cookie })).status, 200);
  assert.deepEqual(new EncryptedStore(dataDir, key).records, {});
});

test('failed retention writes retain live state until persistence succeeds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'skyzen-retention-'));
  try {
    const store = new EncryptedStore(directory, randomBytes(32));
    store.update(records => { records.example = { profile }; });
    const blockedWrite = join(directory, 'passengers.enc.tmp');
    mkdirSync(blockedWrite);
    assert.throws(() => store.purge(Date.parse(profile.arrival) + 24 * 60 * 60_000));
    assert.ok(store.records.example);
    rmSync(blockedWrite, { recursive: true });
    store.purge(Date.parse(profile.arrival) + 24 * 60 * 60_000);
    assert.deepEqual(store.records, {});
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
