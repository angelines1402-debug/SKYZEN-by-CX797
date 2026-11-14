export const $ = id => document.getElementById(id);

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
  return data;
}

export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function time(value) {
  return value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC' : 'Not scheduled';
}

export function message(text, isError = false) {
  $('message').textContent = text;
  $('message').className = isError ? 'notice error' : text ? 'notice' : '';
}

export function readings(passenger) {
  const data = passenger.biomarkers;
  return data ? `Heart rate ${data.heartRate} bpm · SpO₂ ${data.spo2}% · Hydration ${data.hydration}/100 · Stress ${data.stress}/5` : 'No biomarker readings submitted.';
}

export function renderPlan(container, plan) {
  container.replaceChildren();
  for (const warning of plan.warnings) container.append(node('p', warning, 'notice warning'));
  container.append(node('h3', 'Meals'));
  if (!plan.meals.length) container.append(node('p', 'No meal service window fits this short flight. Ask crew about available refreshments.'));
  const meals = node('ul', undefined, 'timeline');
  for (const meal of plan.meals) {
    const entry = node('li');
    entry.append(node('strong', `${time(meal.at)} · ${meal.status}`), node('p', meal.description), node('p', meal.guidance));
    meals.append(entry);
  }
  container.append(meals, node('h3', 'Water & TCM-inspired drink'));
  for (const drink of plan.drinks) container.append(node('p', `${time(drink.at)} — ${drink.description}`));
  container.append(node('h3', 'Rest & caffeine'), node('p', plan.sleep.start
    ? `Rest window: ${time(plan.sleep.start)} → ${time(plan.sleep.end)}`
    : 'No scheduled sleep block.'), node('p', plan.sleep.guidance));
  container.append(node('p', `Caffeine cutoff: ${time(plan.caffeine.cutoff)}`),
    node('p', plan.caffeine.windowStart
      ? `Possible onboard caffeine window: ${time(plan.caffeine.windowStart)} → ${time(plan.caffeine.windowEnd)}`
      : 'No onboard caffeine window fits the six-hour rest buffer.'),
    node('p', plan.caffeine.allowedNow ? 'Optional caffeine fits the current plan.' : 'Choose caffeine-free drinks now.'),
    node('p', plan.caffeine.guidance), node('p', plan.disclaimer, 'muted'));
}

export function renderJobs(container, jobs, cancel) {
  container.replaceChildren();
  if (!jobs.length) container.append(node('p', 'No simulated heating jobs scheduled.'));
  for (const job of jobs) {
    const entry = node('div', undefined, 'job');
    entry.append(node('strong', `${job.machineId} · ${job.temperatureC}°C · ${job.durationMinutes} min · ${job.status}`),
      node('p', `Start ${time(job.startAt)} → serve ${time(job.serveAt)}`));
    if (cancel && job.status !== 'cancelled') {
      const button = node('button', 'Cancel simulated job', 'secondary');
      button.type = 'button';
      button.addEventListener('click', () => cancel(job.id));
      entry.append(button);
    }
    container.append(entry);
  }
}
