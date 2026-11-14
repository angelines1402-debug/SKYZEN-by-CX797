const API_BASE_URL = window.location.origin;

async function fetchAPI(endpoint) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("SkyZen API connection failed:", error);
    throw error;
  }
}

async function postAPI(endpoint, body) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || `API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("SkyZen API request failed:", error);
    throw error;
  }
}

// Check whether the backend is online
async function getHealth() {
  return fetchAPI("/health");
}

// Get all six passengers
async function getSnapshot() {
  return fetchAPI("/snapshot");
}

// Get one passenger's latest readings
async function getPassenger(seat) {
  return fetchAPI(`/passengers/${seat}`);
}

// Get one passenger's reading history
async function getPassengerHistory(seat) {
  return fetchAPI(`/history/${seat}`);
}
// Get one passenger's personalised wellness plan
async function getWellness(seat, symptom, flightPhase) {
  const query = new URLSearchParams();

  if (symptom) {
    query.set("symptom", symptom);
  }
  if (flightPhase) {
    query.set("flight_phase", flightPhase);
  }

  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  return fetchAPI(`/wellness/${encodeURIComponent(seat)}${suffix}`);
}

// Get wellness plans and crew recommendations for all passengers
async function getAllWellness(flightPhase) {
  const query = flightPhase
    ? `?flight_phase=${encodeURIComponent(flightPhase)}`
    : "";
  return fetchAPI(`/wellness${query}`);
}

async function getCrewCoffeeRequests() {
  return fetchAPI("/crew/requests");
}

async function submitCoffeeDecision(seat, decision) {
  return postAPI(`/passengers/${encodeURIComponent(seat)}/coffee`, { decision });
}

async function submitTCMDrinkDecision(seat, decision, drink) {
  return postAPI(`/passengers/${encodeURIComponent(seat)}/tcm-drink`, {
    decision,
    drink,
  });
}

async function submitMealPrepDecision(seat, decision) {
  return postAPI(`/crew/meal-prep/${encodeURIComponent(seat)}`, { decision });
}

function formatFlightHour(hour) {
  const value = Number(hour);
  if (!Number.isFinite(value)) {
    throw new TypeError("Flight hour must be a finite number.");
  }

  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (value < 0) {
    return `${Math.abs(value)}h before CX844 departure`;
  }
  return value === 0 ? "At CX844 departure" : `${formatted}h into CX844`;
}

function formatFlightCountdown(hour, elapsedHours) {
  const remainingHours = Number(hour) - Number(elapsedHours);
  if (!Number.isFinite(remainingHours)) {
    throw new TypeError("Flight hours must be finite numbers.");
  }
  if (Math.abs(remainingHours) < 0.05) {
    return "Now";
  }

  const roundedHours = Math.round(Math.abs(remainingHours) * 10) / 10;
  const duration = roundedHours < 0.1
    ? "<0.1h"
    : `${roundedHours.toFixed(1)}h`;
  return remainingHours > 0 ? `in ${duration}` : `${duration} ago`;
}
