const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const CONSENT_VERSION = '2026-11-14';

export const CONSENT_TEXT = 'With your permission, SKYZEN stores your seat, flight timeline, dietary, rest and caffeine preferences and manually entered heart rate, oxygen saturation, hydration and stress readings. These are encrypted at rest and shared with authorised cabin crew to coordinate wellness service and simulated meal heating. Recommendations are general wellness guidance, not medical advice or diagnosis. No wearable or aircraft equipment is connected. You may withdraw consent and delete your record at any time. Records are deleted 24 hours after arrival while the server is running, or on its next startup. Do not use this prototype for emergencies; contact cabin crew directly.';

function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

export function validateProfile(input, now = Date.now()) {
  if (!input || typeof input !== 'object') fail('Passenger details are required.');
  const seat = String(input.seat || '').trim().toUpperCase();
  const flightNumber = String(input.flightNumber || '').trim().toUpperCase();
  if (!/^[1-9]\d{0,2}[A-K]$/.test(seat)) fail('Enter a valid seat, for example 12A.');
  if (!/^[A-Z0-9]{2,3}\d{1,4}$/.test(flightNumber)) fail('Enter a flight number, for example CX797.');
  const departure = Date.parse(input.departure);
  const arrival = Date.parse(input.arrival);
  if (!/Z$|[+-]\d{2}:\d{2}$/.test(String(input.departure)) ||
      !/Z$|[+-]\d{2}:\d{2}$/.test(String(input.arrival)) ||
      !Number.isFinite(departure) || !Number.isFinite(arrival) ||
      arrival <= departure || arrival - departure > 24 * HOUR ||
      departure < now - 24 * HOUR || departure > now + 7 * 24 * HOUR || arrival <= now) {
    fail('Use timezone-qualified times for an upcoming or active flight lasting at most 24 hours.');
  }
  if (!['standard', 'vegetarian'].includes(input.diet)) fail('Choose a supported meal preference.');
  if (typeof input.allergies !== 'string' || input.allergies.length > 200) fail('Allergy notes must be at most 200 characters.');
  if (typeof input.herbalOptIn !== 'boolean') fail('Choose whether to request a herbal drink.');
  if (input.restPreference !== undefined && !['early', 'late'].includes(input.restPreference)) fail('Choose an early or late rest preference.');
  if (input.caffeineSensitive !== undefined && typeof input.caffeineSensitive !== 'boolean') fail('Caffeine sensitivity must be true or false.');
  return {
    seat, flightNumber, departure: new Date(departure).toISOString(),
    arrival: new Date(arrival).toISOString(), diet: input.diet,
    allergies: input.allergies.trim(), herbalOptIn: input.herbalOptIn,
    restPreference: input.restPreference || 'early', caffeineSensitive: input.caffeineSensitive || false
  };
}

export function validateBiomarkers(input) {
  if (!input || typeof input !== 'object') fail('Biomarker readings are required.');
  const ranges = { heartRate: [30, 220], spo2: [70, 100], hydration: [0, 100], stress: [1, 5] };
  const result = {};
  for (const [name, [min, max]] of Object.entries(ranges)) {
    const value = input[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      fail(`${name} must be a number between ${min} and ${max}.`);
    }
    result[name] = value;
  }
  return result;
}

export function recommend(passenger, now = Date.now()) {
  const { profile, biomarkers, updatedAt } = passenger;
  const departure = Date.parse(profile.departure);
  const arrival = Date.parse(profile.arrival);
  const duration = arrival - departure;
  const phase = now < departure ? 'pre-flight' : now >= arrival ? 'arrived' :
    now >= arrival - 45 * MINUTE ? 'arrival preparation' : 'in-flight';
  const warnings = [];
  if (biomarkers && (biomarkers.spo2 < 92 || biomarkers.heartRate > 120 || biomarkers.heartRate < 45)) {
    warnings.push('A reading is outside this prototype’s wellness range. Recheck the device and contact cabin crew; do not rely on the app for medical assessment.');
  }
  const stale = !updatedAt || now - Date.parse(updatedAt) > 30 * MINUTE;
  if (stale) warnings.push('No recent reading (within 30 minutes). Recommendations are provisional; enter a fresh reading.');
  if (profile.allergies) warnings.push('Crew must confirm ingredients and cross-contact safety before any meal or drink is served.');
  const latestSleepEnd = arrival - 90 * MINUTE;
  const sleepStart = profile.restPreference === 'late'
    ? Math.max(departure + 2 * HOUR, latestSleepEnd - 4 * HOUR) : departure + 2 * HOUR;
  const sleepEnd = profile.restPreference === 'late' ? latestSleepEnd : Math.min(latestSleepEnd, sleepStart + 6 * HOUR);
  const hasSleep = duration >= 4 * HOUR && sleepEnd > sleepStart;
  const meals = [];
  const firstMeal = departure + (duration <= 2 * HOUR ? 20 : 60) * MINUTE;
  let mealSlot = 0;
  for (let time = firstMeal; time <= arrival - 45 * MINUTE; time += 4 * HOUR) {
    mealSlot++;
    if (hasSleep && time >= sleepStart && time < sleepEnd) continue;
    meals.push({
      id: `meal-${mealSlot}`,
      at: new Date(time).toISOString(),
      description: profile.diet === 'vegetarian'
        ? 'Vegetarian meal: vegetables, whole grains and plant protein'
        : 'Balanced meal: vegetables, whole grains and lean protein',
      guidance: biomarkers?.hydration < 40
        ? 'With your low self-reported hydration, ask about a less salty option if consistent with your prescribed diet.'
        : biomarkers?.stress >= 4 ? 'If you feel stressed, consider a light portion and eat at a comfortable pace.' : 'Choose a comfortable portion; crew will confirm availability and ingredients.',
      status: now > time + 30 * MINUTE ? 'past' : now >= time - 30 * MINUTE ? 'due' : 'upcoming',
      needsIngredientCheck: Boolean(profile.allergies)
    });
  }
  const cutoff = (hasSleep ? sleepStart : arrival) - 6 * HOUR;
  const sleep = hasSleep ? {
    start: new Date(sleepStart).toISOString(), end: new Date(sleepEnd).toISOString(),
    guidance: biomarkers?.stress >= 4
      ? 'Wind down with slow breathing, then dim your screen and rest. Sleep only when comfortable and follow crew instructions.'
      : 'Dim your screen and rest when comfortable. Keep your seat belt visible and follow crew instructions.'
  } : { start: null, end: null, guidance: 'Short flight: consider a brief rest rather than a scheduled sleep block.' };
  const caffeine = {
    cutoff: new Date(cutoff).toISOString(),
    windowStart: cutoff > departure ? profile.departure : null,
    windowEnd: cutoff > departure ? new Date(cutoff).toISOString() : null,
    allowedNow: now >= departure && now < Math.min(cutoff, arrival) && !warnings.length &&
      !profile.caffeineSensitive && !(biomarkers?.stress >= 4),
    guidance: profile.caffeineSensitive || biomarkers?.stress >= 4
      ? 'Choose caffeine-free drinks because of your reported caffeine sensitivity or high stress.'
      : 'Optional caffeine only before the cutoff, at least six hours before planned rest (or arrival on short flights). Sensitivity varies; choose caffeine-free if unsure.'
  };
  const drinks = [{
    type: 'water',
    description: biomarkers?.hydration < 40
      ? 'Your self-reported hydration is low. Sip water regularly if you have no prescribed fluid restriction.'
      : 'Sip water with meals and when thirsty; follow any prescribed fluid restriction.',
    at: new Date(Math.max(departure, Math.min(now, arrival))).toISOString()
  }];
  drinks.push({
    type: 'tcm-inspired',
    description: profile.herbalOptIn && !profile.allergies && !warnings.length
      ? 'Optional caffeine-free, TCM-inspired ginger infusion. Ask crew to confirm ingredients; avoid if pregnant, taking medication, or advised against herbs. No therapeutic benefit is claimed.'
      : 'Herbal drink deferred. Choose plain warm water; herbal drinks require opt-in, fresh readings and ingredient review.',
    at: meals.find(meal => meal.status !== 'past')?.at || new Date(Math.max(departure, Math.min(now, arrival))).toISOString()
  });
  return {
    phase, generatedAt: new Date(now).toISOString(), stale, warnings, meals, drinks, sleep, caffeine,
    disclaimer: 'General wellness guidance only, not a diagnosis or medical treatment. Meal and rest times are suggestions subject to flight operations.'
  };
}
