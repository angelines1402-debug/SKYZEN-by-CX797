import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, validateProfile, validateBiomarkers } from './wellness.js';

const now = Date.parse('2026-11-14T10:00:00Z');
const profile = {
  seat: '12A', flightNumber: 'CX797', departure: '2026-11-14T10:00:00Z',
  arrival: '2026-11-14T20:00:00Z', diet: 'vegetarian', allergies: '', herbalOptIn: true
};
const readings = { heartRate: 75, spo2: 98, hydration: 30, stress: 4 };
const passenger = { profile, biomarkers: readings, updatedAt: new Date(now).toISOString() };

test('validates input without coercing or retaining unknown biomarker fields', () => {
  assert.deepEqual(validateBiomarkers({ ...readings, extra: 'ignored' }), readings);
  for (const value of [null, NaN, Infinity, '75', 221]) {
    assert.throws(() => validateBiomarkers({ ...readings, heartRate: value }));
  }
  assert.equal(validateProfile(profile, now).seat, '12A');
  assert.throws(() => validateProfile({ ...profile, arrival: profile.departure }, now));
  assert.throws(() => validateProfile({ ...profile, departure: '2026-11-14T10:00:00' }, now));
  assert.throws(() => validateProfile({ ...profile, diet: 'unknown' }, now));
});

test('personalises meals, drinks and sleep with flight-bounded timestamps', () => {
  const plan = recommend(passenger, now);
  assert.equal(plan.phase, 'in-flight');
  assert.match(plan.meals[0].description, /Vegetarian/);
  assert.match(plan.drinks[0].description, /hydration is low/);
  assert.match(plan.drinks[1].description, /ginger/);
  assert.match(plan.sleep.guidance, /slow breathing/);
  assert.equal(plan.sleep.start, '2026-11-14T12:00:00.000Z');
  assert.equal(plan.sleep.end, '2026-11-14T18:30:00.000Z');
  assert.equal(plan.caffeine.cutoff, '2026-11-14T06:00:00.000Z');
  assert.equal(plan.caffeine.allowedNow, false);
  assert.equal(plan.caffeine.windowStart, null);
  assert.ok(plan.meals.every(meal => Date.parse(meal.at) < Date.parse(profile.arrival)));
});

test('short flights, stale readings, allergies and concerning readings are handled conservatively', () => {
  const short = recommend({ ...passenger, profile: { ...profile, arrival: '2026-11-14T11:00:00Z', allergies: 'ginger' } }, now);
  assert.equal(short.sleep.start, null);
  assert.equal(short.meals.length, 0);
  assert.match(short.drinks[1].description, /deferred/);
  assert.ok(short.warnings.some(message => message.includes('ingredients')));
  assert.equal(recommend(passenger, now - 1).phase, 'pre-flight');
  assert.equal(recommend(passenger, Date.parse(profile.arrival)).phase, 'arrived');
  const stale = recommend(passenger, now + 31 * 60_000);
  assert.equal(stale.stale, true);
  assert.match(stale.drinks[1].description, /deferred/);
  const warning = recommend({ ...passenger, biomarkers: { ...readings, spo2: 85 } }, now);
  assert.ok(warning.warnings.some(message => message.includes('contact cabin crew')));
  assert.equal(warning.caffeine.allowedNow, false);
});
