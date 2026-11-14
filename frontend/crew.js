import { $, api, node, time, message, readings, renderPlan, renderJobs } from './common.js';

let passengers = [];
let signedIn = false;
let generation = 0;
let refreshing = false;

function signOut() {
  generation++;
  signedIn = false;
  passengers = [];
  $('login-panel').hidden = false;
  $('crew-dashboard').hidden = true;
  for (const id of ['passengers', 'galley-passenger', 'galley-meal', 'sync-status']) $(id).replaceChildren();
  $('galley-form').reset();
  $('login-form').reset();
}

function options(select, values) {
  const previous = select.value;
  select.replaceChildren();
  for (const [value, label] of values) {
    const option = node('option', label);
    option.value = value;
    select.append(option);
  }
  if (values.some(([value]) => value === previous)) select.value = previous;
}

function updateMeals() {
  const passenger = passengers.find(item => item.id === $('galley-passenger').value);
  const meals = passenger && passenger.recommendations.phase !== 'arrived'
    ? passenger.recommendations.meals.filter(meal => meal.status !== 'past' &&
      !passenger.galleyJobs.some(job => job.mealId === meal.id && job.status !== 'cancelled'))
    : [];
  options($('galley-meal'), meals.map(meal => [meal.id, `${time(meal.at)} · ${meal.description}`]));
  $('schedule').disabled = !meals.length;
}

async function cancelJob(passengerId, jobId) {
  try {
    await api('/api/crew/galley/cancel', { method: 'POST', body: { passengerId, jobId } });
    message('Simulated heating job cancelled.');
    await refresh();
  } catch (err) {
    if (err.status === 401) signOut();
    message(err.message, true);
  }
}

function render(data) {
  passengers = data.passengers;
  signedIn = true;
  $('login-panel').hidden = true;
  $('crew-dashboard').hidden = false;
  $('sync-status').textContent = `${passengers.length} consenting passenger(s) · Synced ${time(new Date().toISOString())} · Polling every 10 seconds`;
  $('passengers').replaceChildren();
  if (!passengers.length) $('passengers').append(node('p', 'No consenting passengers yet.'));
  for (const passenger of passengers) {
    const card = node('section', undefined, 'panel passenger-card');
    card.append(node('h2', `${passenger.profile.flightNumber} · Seat ${passenger.profile.seat}`),
      node('p', `${time(passenger.profile.departure)} → ${time(passenger.profile.arrival)}`),
      node('span', passenger.recommendations.phase, 'badge'),
      node('p', readings(passenger)),
      node('p', `Last reading: ${time(passenger.updatedAt)}`, 'muted'),
      node('p', `Allergy notes: ${passenger.profile.allergies || 'None reported — verify before service'}`),
      node('p', `Consent ${passenger.consent.version} · Accepted ${time(passenger.consent.acceptedAt)}`, 'muted'));
    const plan = node('div');
    renderPlan(plan, passenger.recommendations);
    const jobs = node('div');
    renderJobs(jobs, passenger.galleyJobs, jobId => cancelJob(passenger.id, jobId));
    card.append(plan, node('h3', 'Simulated galley jobs'), jobs);
    $('passengers').append(card);
  }
  options($('galley-passenger'), passengers.map(passenger => [passenger.id, `${passenger.profile.flightNumber} · ${passenger.profile.seat}`]));
  updateMeals();
}

async function refresh(quiet = false) {
  if (refreshing) return;
  refreshing = true;
  const current = generation;
  try {
    const data = await api('/api/crew/passengers');
    if (current === generation) render(data);
  } catch (err) {
    if (current !== generation) return;
    if (err.status === 401) {
      signOut();
      if (!quiet) message('Crew session ended. Sign in again.');
    } else {
      $('sync-status').textContent = 'Live sync unavailable — displayed readings and jobs may be outdated.';
      message(err.message, true);
    }
  } finally {
    refreshing = false;
  }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/crew/login', { method: 'POST', body: { token: values.get('token') } });
    form.reset();
    generation++;
    await refresh();
    message('Crew access enabled. Galley commands are simulations only.');
  } catch (err) {
    message(err.message, true);
  } finally {
    button.disabled = false;
  }
});
$('refresh').addEventListener('click', () => refresh());
$('galley-passenger').addEventListener('change', updateMeals);
$('logout').addEventListener('click', async () => {
  try {
    await api('/api/crew/logout', { method: 'POST' });
    signOut();
    message('Signed out.');
  } catch (err) {
    message(err.message, true);
  }
});
$('galley-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  $('schedule').disabled = true;
  try {
    await api('/api/crew/galley', { method: 'POST', body: {
      passengerId: values.get('passengerId'), mealId: values.get('mealId'),
      machineId: values.get('machineId'), temperatureC: Number(values.get('temperatureC')),
      durationMinutes: Number(values.get('durationMinutes')), crewConfirmed: values.has('crewConfirmed')
    } });
    form.elements.crewConfirmed.checked = false;
    message('Simulated heating scheduled. No command was sent to physical equipment.');
    await refresh();
  } catch (err) {
    if (err.status === 401) signOut();
    message(err.message, true);
  } finally {
    updateMeals();
  }
});

await refresh(true);
setInterval(() => { if (signedIn) refresh(); }, 10_000);
