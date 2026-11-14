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
