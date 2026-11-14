import { createServer as httpServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EncryptedStore } from './store.js';
import { CONSENT_TEXT, CONSENT_VERSION, validateProfile, validateBiomarkers, recommend } from './wellness.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
const assets = {
  '/': ['passenger.html', 'text/html'],
  '/passenger.html': ['passenger.html', 'text/html'],
  '/crew.html': ['crew.html', 'text/html'],
  '/styles.css': ['styles.css', 'text/css'],
  '/passenger.js': ['passenger.js', 'text/javascript'],
  '/crew.js': ['crew.js', 'text/javascript'],
  '/common.js': ['common.js', 'text/javascript']
};

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw error(415, 'Use application/json.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8192) throw error(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw error(400, 'Provide a JSON object.');
  }
}

function cookie(req, name) {
  return (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

export function createApp({ key, crewToken, dataDir = join(ROOT, 'data'), secureCookies = false,
  origin = 'http://localhost:3000', clock = Date.now } = {}) {
  if (typeof crewToken !== 'string' || crewToken.length < 32) throw new Error('CREW_TOKEN must contain at least 32 characters.');
  const store = new EncryptedStore(dataDir, key);
  const sessions = new Map();
  const attempts = new Map();
  store.purge(clock());
  const purgeTimer = setInterval(() => {
    try { store.purge(clock()); } catch { console.error('Encrypted storage maintenance failed.'); }
  }, 60_000);
  purgeTimer.unref();
  const view = passenger => ({
    id: passenger.id, profile: passenger.profile, consent: passenger.consent,
    biomarkers: passenger.biomarkers, updatedAt: passenger.updatedAt,
    recommendations: recommend(passenger, clock()), galleyJobs: passenger.galleyJobs
  });
  const server = httpServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const setCookie = (name, value, maxAge) => res.setHeader('Set-Cookie',
      `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`);
    const passengerAuth = () => {
      const token = cookie(req, 'skyzen_passenger');
      const passenger = token && Object.values(store.records).find(item => item.tokenHash === hash(token));
      if (!passenger) throw error(401, 'Passenger consent and sign-in are required.');
      return passenger;
    };
    const crewAuth = () => {
      const token = cookie(req, 'skyzen_crew');
      const session = token && sessions.get(hash(token));
      if (!session || session.expires <= clock()) throw error(401, 'Crew sign-in is required.');
    };
    try {
      const path = new URL(req.url, origin).pathname;
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw error(405, 'Method not allowed.');
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== origin) {
        throw error(403, 'Cross-origin writes are not allowed.');
      }
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(readFileSync(join(ROOT, 'frontend', file)));
      }
      store.purge(clock());
      if (req.method === 'GET' && path === '/api/consent') {
        return json(200, { version: CONSENT_VERSION, text: CONSENT_TEXT });
      }
      if (req.method === 'POST' && ['/api/passengers', '/api/crew/login'].includes(path)) {
        const address = req.socket.remoteAddress;
        const now = clock();
        for (const [ip, attempt] of attempts) if (now >= attempt.until) attempts.delete(ip);
        const attempt = attempts.get(address) || { count: 0, until: now + 60_000 };
        if (++attempt.count > 15) throw error(429, 'Too many attempts. Try again in a minute.');
        attempts.set(address, attempt);
        const body = await readBody(req);
        if (path === '/api/crew/login') {
          if (typeof body.token !== 'string' || !timingSafeEqual(Buffer.from(hash(body.token)), Buffer.from(hash(crewToken)))) {
            throw error(401, 'Invalid crew credential.');
          }
          for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
          const token = randomBytes(32).toString('hex');
          sessions.set(hash(token), { expires: now + 8 * 60 * 60_000 });
          setCookie('skyzen_crew', token, 8 * 60 * 60);
          return json(200, { authenticated: true });
        }
        if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) {
          throw error(400, 'Explicit agreement to the current consent notice is required.');
        }
        if (cookie(req, 'skyzen_passenger') && Object.values(store.records).some(item => item.tokenHash === hash(cookie(req, 'skyzen_passenger')))) {
          throw error(409, 'Withdraw your existing consent before starting another passenger record.');
        }
        const profile = validateProfile(body.profile, clock());
        if (Object.values(store.records).some(item => item.profile.seat === profile.seat &&
          item.profile.flightNumber === profile.flightNumber && item.profile.departure === profile.departure)) {
          throw error(409, 'This seat already has a record for this flight. Ask crew for assistance.');
        }
        const token = randomBytes(32).toString('hex');
        const passenger = {
          id: randomUUID(), tokenHash: hash(token), profile,
          consent: { version: CONSENT_VERSION, acceptedAt: new Date(clock()).toISOString() },
          biomarkers: null, updatedAt: null, galleyJobs: []
        };
        store.update(records => { records[passenger.id] = passenger; });
        setCookie('skyzen_passenger', token, Math.ceil((Date.parse(profile.arrival) + 24 * 60 * 60_000 - clock()) / 1000));
        return json(201, view(passenger));
      }
      if (path === '/api/passenger' && req.method === 'GET') return json(200, view(passengerAuth()));
      if (path === '/api/passenger' && req.method === 'DELETE') {
        const passenger = passengerAuth();
        store.update(records => { delete records[passenger.id]; });
        setCookie('skyzen_passenger', '', 0);
        return json(200, { deleted: true });
      }
      if (path === '/api/passenger/biomarkers' && req.method === 'POST') {
        const passenger = passengerAuth();
        if (clock() >= Date.parse(passenger.profile.arrival)) throw error(409, 'This flight has arrived; new readings are closed.');
        const biomarkers = validateBiomarkers(await readBody(req));
        const updated = store.update(records => {
          const target = records[passenger.id];
          if (!target) throw error(401, 'Passenger consent has been withdrawn.');
          target.biomarkers = biomarkers;
          target.updatedAt = new Date(clock()).toISOString();
          return target;
        });
        return json(200, view(updated));
      }
      if (path === '/api/crew/logout' && req.method === 'POST') {
        sessions.delete(hash(cookie(req, 'skyzen_crew')));
        setCookie('skyzen_crew', '', 0);
        return json(200, { authenticated: false });
      }
      if (path === '/api/crew/passengers' && req.method === 'GET') {
        crewAuth();
        return json(200, { passengers: Object.values(store.records).map(view) });
      }
      if (path === '/api/crew/galley' && req.method === 'POST') {
        crewAuth();
        const body = await readBody(req);
        const passenger = typeof body.passengerId === 'string' &&
          Object.values(store.records).find(item => item.id === body.passengerId);
        if (!passenger) throw error(404, 'Passenger not found or consent withdrawn.');
        const plan = recommend(passenger, clock());
        const meal = plan.meals.find(item => item.id === body.mealId);
        if (!meal || meal.status === 'past' || clock() >= Date.parse(passenger.profile.arrival)) {
          throw error(409, 'Choose a current or upcoming meal from this passenger’s plan.');
        }
        if (body.crewConfirmed !== true) throw error(400, 'Crew must confirm ingredients and approved heating instructions.');
        if (!Number.isInteger(body.temperatureC) || body.temperatureC < 60 || body.temperatureC > 220 ||
            !Number.isInteger(body.durationMinutes) || body.durationMinutes < 1 || body.durationMinutes > 45 ||
            !['oven-1', 'oven-2'].includes(body.machineId)) {
          throw error(400, 'Choose oven-1 or oven-2, 60–220°C and 1–45 minutes.');
        }
        if (passenger.galleyJobs.some(job => job.mealId === meal.id && job.status !== 'cancelled')) {
          throw error(409, 'This meal already has a simulated heating job.');
        }
        const serveAt = Math.max(clock() + body.durationMinutes * 60_000, Date.parse(meal.at));
        const startAt = serveAt - body.durationMinutes * 60_000;
        if (serveAt > Date.parse(passenger.profile.arrival) - 45 * 60_000) {
          throw error(409, 'Heating would finish too close to arrival.');
        }
        if (Object.values(store.records).some(item => item.galleyJobs.some(job =>
          job.status !== 'cancelled' && job.machineId === body.machineId &&
          startAt < Date.parse(job.serveAt) && serveAt > Date.parse(job.startAt)))) {
          throw error(409, 'This oven already has an overlapping simulated job.');
        }
        const job = {
          id: randomUUID(), mealId: meal.id, machineId: body.machineId,
          temperatureC: body.temperatureC, durationMinutes: body.durationMinutes,
          startAt: new Date(startAt).toISOString(), serveAt: new Date(serveAt).toISOString(),
          status: 'simulated', createdAt: new Date(clock()).toISOString()
        };
        store.update(records => { records[passenger.id].galleyJobs.push(job); });
        return json(201, { job, simulationOnly: true });
      }
      if (path === '/api/crew/galley/cancel' && req.method === 'POST') {
        crewAuth();
        const body = await readBody(req);
        const passenger = Object.values(store.records).find(item => item.id === body.passengerId);
        const job = passenger?.galleyJobs.find(item => item.id === body.jobId);
        if (!job) throw error(404, 'Job not found.');
        const cancelled = store.update(records => {
          const target = records[passenger.id].galleyJobs.find(item => item.id === job.id);
          target.status = 'cancelled';
          return target;
        });
        return json(200, { job: cancelled, simulationOnly: true });
      }
      throw error(404, 'Not found.');
    } catch (err) {
      json(err.status || 500, { error: err.status ? err.message : 'Unable to process request.' });
    }
  });
  server.on('close', () => clearInterval(purgeTimer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keyHex = process.env.DATA_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('Set DATA_ENCRYPTION_KEY to a random 64-character hexadecimal key.');
  if (process.env.NODE_ENV === 'production' &&
      (process.env.COOKIE_SECURE !== 'true' || !process.env.PUBLIC_ORIGIN?.startsWith('https://'))) {
    throw new Error('Production requires COOKIE_SECURE=true and an HTTPS PUBLIC_ORIGIN.');
  }
  const port = Number(process.env.PORT || 3000);
  createApp({
    key: Buffer.from(keyHex, 'hex'), crewToken: process.env.CREW_TOKEN,
    dataDir: process.env.DATA_DIR || join(ROOT, 'data'),
    secureCookies: process.env.COOKIE_SECURE === 'true',
    origin: process.env.PUBLIC_ORIGIN || `http://localhost:${port}`
  }).listen(port, '127.0.0.1', () => console.log(`SKYZEN listening on http://localhost:${port} (galley simulation only)`));
}
