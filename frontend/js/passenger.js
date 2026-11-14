const PASSENGER_SEAT = "2A";
const FLIGHT_PHASES = ["boarding", "climb", "cruise", "descent"];
let activeSymptom = null;

function updateBadge(elementId, status) {
  const badge = document.getElementById(elementId);

  badge.textContent =
    status === "NORMAL" ? "Normal" : status;

  badge.className =
    status === "NORMAL"
      ? "metric-badge"
      : "metric-badge warn";
}

function updatePassengerDashboard(passenger) {
  // Passenger information
  document.getElementById("passenger-name").textContent =
    passenger.name;

  document.getElementById("passenger-seat").textContent =
    `Seat ${passenger.seat}`;

  // HRV
  document.getElementById("hrv-value").innerHTML =
    `${passenger.hrv.value}<small> ms</small>`;

  updateBadge("hrv-status", passenger.hrv.status);

  // SpO2
  document.getElementById("spo2-value").innerHTML =
    `${passenger.spo2.value}<small>%</small>`;

  updateBadge("spo2-status", passenger.spo2.status);

  // Data source
  document.getElementById("data-source").textContent =
    passenger.data_source === "LIVE_SIMULATION"
      ? "● Live simulated readings · Updating every 2 seconds"
      : "● Predefined passenger profile";

  // Monitoring status
  const monitoringStatus =
    document.getElementById("monitoring-status");

  const monitoringDetail =
    document.getElementById("monitoring-detail");

  if (passenger.priority === "Normal") {
    monitoringStatus.innerHTML =
      '<span class="dot dot-green"></span> No flags';

    monitoringDetail.textContent =
      "All readings within demo ranges";
  } else {
    monitoringStatus.innerHTML =
      '<span class="dot dot-amber"></span> Check-in suggested';

    monitoringDetail.textContent =
      `${passenger.flags.length} reading(s) flagged for review`;
  }
}

async function refreshPassengerDashboard() {
  try {
    const passenger = await getPassenger(PASSENGER_SEAT);
    updatePassengerDashboard(passenger);
  } catch (error) {
    document.getElementById("data-source").textContent =
      "Unable to connect to SkyZen API";
  }
}

// Load immediately, then refresh every 2 seconds
refreshPassengerDashboard();
setInterval(refreshPassengerDashboard, 2000);
function renderWellnessMenus(panel, menus) {
  let menuContainer = panel.querySelector("#wellness-plan-menus");

  if (!menuContainer) {
    menuContainer = document.createElement("section");
    menuContainer.id = "wellness-plan-menus";
    panel.appendChild(menuContainer);
  }

  menuContainer.replaceChildren();

  const heading = document.createElement("h3");
  heading.textContent = menus.symptom
    ? `Menu options for ${menus.symptom}`
    : "All menu options";
  menuContainer.appendChild(heading);

  menus.available.forEach(menuType => {
    const menuName = menuType.toLowerCase();
    const menuSection = document.createElement("section");
    const menuHeading = document.createElement("h4");
    const menuItems = document.createElement("ul");

    menuHeading.textContent = `${menuType} menu`;

    menus[menuName].forEach(menuItem => {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const description = document.createElement("p");
      const tag = document.createElement("small");

      name.textContent = menuItem.name;
      description.textContent = menuItem.description;
      tag.textContent = menuItem.tag;

      item.append(name, description, tag);
      menuItems.appendChild(item);
    });

    menuSection.append(menuHeading, menuItems);
    menuContainer.appendChild(menuSection);
  });
}

function getFlightPhaseSelector(panel) {
  let selector = panel.querySelector("#flight-phase");

  if (!selector) {
    const label = document.createElement("label");
    selector = document.createElement("select");
    selector.id = "flight-phase";
    label.htmlFor = selector.id;
    label.textContent = "Flight phase ";

    const unsetOption = document.createElement("option");
    unsetOption.value = "";
    unsetOption.textContent = "Select phase";
    selector.appendChild(unsetOption);

    FLIGHT_PHASES.forEach(phase => {
      const option = document.createElement("option");
      option.value = phase;
      option.textContent = phase[0].toUpperCase() + phase.slice(1);
      selector.appendChild(option);
    });

    label.appendChild(selector);
    panel.prepend(label);
  }

  if (selector.dataset.wellnessPhaseBound !== "true") {
    selector.addEventListener("change", () => {
      loadWellnessPlan(activeSymptom, selector.value || null);
    });
    selector.dataset.wellnessPhaseBound = "true";
  }

  return selector;
}

// Load and display the passenger's personalised wellness plan
async function loadWellnessPlan(symptom = activeSymptom, flightPhase) {
  const panel = document.getElementById("wellness-plan-panel");
  const title = document.getElementById("wellness-plan-title");
  const actions = document.getElementById("wellness-plan-actions");
  const disclaimer = document.getElementById("wellness-disclaimer");
  activeSymptom = symptom;

  const phaseSelector = getFlightPhaseSelector(panel);
  if (flightPhase !== undefined) {
    phaseSelector.value = flightPhase || "";
  }
  const selectedPhase =
    flightPhase === undefined
      ? phaseSelector.value || null
      : flightPhase;

  title.textContent = "Loading your wellness suggestions...";
  actions.innerHTML = "";

  try {
    const plan = await getWellness(
      PASSENGER_SEAT,
      symptom,
      selectedPhase
    );

    title.textContent = plan.passenger_plan.title;

    plan.passenger_plan.actions.forEach(action => {
      const item = document.createElement("li");
      item.textContent = action;
      actions.appendChild(item);
    });

    renderWellnessMenus(panel, plan.menus);
    disclaimer.textContent = plan.disclaimer;

  } catch (error) {
    title.textContent = "Unable to load your wellness plan";
    console.error("Wellness plan error:", error);
  }
}

// Open and close the wellness plan panel
const wellnessButton = document.querySelector(".wellness-btn");
const wellnessPanel = document.getElementById("wellness-plan-panel");

wellnessButton.addEventListener("click", async () => {
  const isHidden = wellnessPanel.style.display === "none";

  wellnessPanel.style.display = isHidden ? "block" : "none";

  if (isHidden) {
    await loadWellnessPlan();
  }
});
