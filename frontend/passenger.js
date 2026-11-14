import { $, api, time, message, readings, renderPlan, renderJobs } from './common.js';

let consentVersion;
let signedIn = false;
let generation = 0;
let refreshing = false;

function render(passenger) {
  signedIn = true;
  $('enrolment').hidden = true;
  $('passenger-dashboard').hidden = false;
  $('flight-title').textContent = `${passenger.profile.flightNumber} · Seat ${passenger.profile.seat}`;
  $('flight-times').textContent = `${time(passenger.profile.departure)} → ${time(passenger.profile.arrival)}`;
  $('flight-phase').textContent = passenger.recommendations.phase;
  $('last-updated').textContent = `Reading: ${time(passenger.updatedAt)} · Refreshes every 10 seconds`;
  $('current-readings').textContent = readings(passenger);
  for (const input of $('biomarker-form').elements) input.disabled = passenger.recommendations.phase === 'arrived';
  renderPlan($('plan'), passenger.recommendations);
  renderJobs($('passenger-jobs'), passenger.galleyJobs);
}

function clearSession() {
  generation++;
  signedIn = false;
  $('enrolment').hidden = false;
  $('passenger-dashboard').hidden = true;
  $('consent-form').reset();
  $('consent-fields').disabled = true;
  $('biomarker-form').reset();
  for (const id of ['flight-title', 'flight-times', 'flight-phase', 'last-updated', 'current-readings', 'plan', 'passenger-jobs']) $(id).replaceChildren();
}

$('consent-agree').addEventListener('change', event => {
  $('consent-fields').disabled = !event.currentTarget.checked;
});

async function refresh(quiet = false) {
  if (refreshing) return;
  refreshing = true;
  const current = generation;
  try {
    const passenger = await api('/api/passenger');
    if (current === generation) render(passenger);
  } catch (err) {
    if (current !== generation) return;
    if (err.status === 401) {
      clearSession();
      if (!quiet) message('Your passenger session ended or consent was withdrawn.');
    } else message(`Live sync unavailable: ${err.message}. Displayed data may be outdated.`, true);
  } finally {
    refreshing = false;
  }
}

$('consent-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const passenger = await api('/api/passengers', { method: 'POST', body: {
      consent: values.has('consent'), consentVersion,
      profile: {
        seat: values.get('seat'), flightNumber: values.get('flightNumber'),
        departure: new Date(`${values.get('departure')}Z`).toISOString(),
        arrival: new Date(`${values.get('arrival')}Z`).toISOString(),
        diet: values.get('diet'), restPreference: values.get('restPreference'),
        allergies: values.get('allergies'), herbalOptIn: values.has('herbalOptIn'),
        caffeineSensitive: values.has('caffeineSensitive')
      }
    } });
    generation++;
    render(passenger);
    message('Consent recorded. You can now submit readings; authorised crew can see your plan.');
  } catch (err) {
    message(err.message, true);
  } finally {
    button.disabled = false;
  }
});

$('biomarker-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const current = generation;
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const body = Object.fromEntries(['heartRate', 'spo2', 'hydration', 'stress'].map(name => [name, Number(values.get(name))]));
    const passenger = await api('/api/passenger/biomarkers', { method: 'POST', body });
    if (current === generation) {
      render(passenger);
      message('Readings updated. Your new recommendations are available to crew.');
    }
  } catch (err) {
    if (err.status === 401) clearSession();
    message(err.message, true);
  } finally {
    button.disabled = false;
  }
});

$('withdraw').addEventListener('click', async () => {
  if (!confirm('Withdraw consent and permanently delete your passenger data and simulated heating jobs?')) return;
  $('withdraw').disabled = true;
  try {
    await api('/api/passenger', { method: 'DELETE' });
    clearSession();
    message('Consent withdrawn. Your passenger record and simulated jobs have been deleted.');
  } catch (err) {
    message(err.message, true);
  } finally {
    $('withdraw').disabled = false;
  }
});

try {
  const consent = await api('/api/consent');
  consentVersion = consent.version;
  $('consent-text').textContent = consent.text;
  $('consent-agree').disabled = false;
  await refresh(true);
} catch (err) {
  message(`Cannot load consent information: ${err.message}. No data can be submitted.`, true);
}
setInterval(() => { if (signedIn) refresh(); }, 10_000);
