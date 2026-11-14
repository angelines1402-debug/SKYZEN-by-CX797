const PASSENGER_SEAT =
  new URLSearchParams(window.location.search).get("seat") || "2A";

document.querySelectorAll(
  'a[href="/static/passenger/meals.html"], a[href="/static/passenger/wellness.html"], a[href="/static/passenger/sleep.html"], a[href="/static/passenger/profile.html"]'
).forEach(link => {
  const url = new URL(link.href);
  url.searchParams.set("seat", PASSENGER_SEAT);
  link.href = url.href;
});

const FLIGHT_PHASES = ["boarding", "climb", "cruise", "descent"];
const flightFlipCard = document.getElementById("flight-flip-card");
function toggleFlightCard() {
  const isFlipped = flightFlipCard.classList.toggle("is-flipped");
  flightFlipCard.setAttribute("aria-pressed", String(isFlipped));
  flightFlipCard.setAttribute(
    "aria-label",
    isFlipped ? "Return to in-flight details" : "Show flight history"
  );
  document.getElementById("in-flight-face").setAttribute("aria-hidden", String(isFlipped));
  document.getElementById("flight-history-face").setAttribute("aria-hidden", String(!isFlipped));
}
flightFlipCard.addEventListener("click", toggleFlightCard);
flightFlipCard.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleFlightCard();
  }
});

let activeSymptom = null;
let currentPassenger = null;
let lastActionSignature = null;
let tcmCountdownTimer = null;
let tcmOpener = null;
let recommendedTCMDrink = null;

const TCM_DRINK_RECOMMENDATIONS = {
  fatigue: {
    name: "Evening Calm 酸棗仁百合紅棗茶",
    reason: "Your profile reports fatigue. The menu lists Evening Calm for sleep preparation.",
  },
  nausea: {
    name: "Harmony Tea 陳皮菊花茶",
    reason: "Your profile reports nausea. The menu describes Harmony Tea as traditionally used to aid digestion and refresh the body.",
  },
  general: {
    name: "Harmony Tea 陳皮菊花茶",
    reason: "No fatigue or nausea is reported. Harmony Tea is the menu's general caffeine-free tea for dinner or breakfast.",
  },
};

function updateBadge(elementId, status) {
  const badge = document.getElementById(elementId);

  badge.textContent =
    status === "NORMAL"
      ? "Normal"
      : `${status[0]}${status.slice(1).toLowerCase()}`;

  badge.classList.toggle("warn", status !== "NORMAL");
}

function updateSleepCountdown(passenger) {
  const countdown = document.getElementById("sleep-countdown");
  const sleepStart = passenger.schedule?.find(
    event => event.type === "sleep_start"
  );
  const elapsed = Number(passenger.flight_elapsed_hours);

  if (!sleepStart || !Number.isFinite(elapsed)) {
    countdown.textContent = "Sleep schedule unavailable";
    return;
  }

  const minutesUntilSleep = Math.floor((sleepStart.hour - elapsed) * 60);
  if (minutesUntilSleep <= 0) {
    countdown.textContent = "Sleep cycle underway";
    return;
  }

  const hours = Math.floor(minutesUntilSleep / 60);
  const minutes = minutesUntilSleep % 60;
  countdown.textContent = hours
    ? `${hours}h ${minutes}m`
    : `${minutes}m`;
}

function makeActionButton(label, callback, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (primary) button.className = "primary";
  button.addEventListener("click", callback);
  return button;
}

function renderRecommendedAction(passenger) {
  const schedule = Array.isArray(passenger.schedule) ? passenger.schedule : [];
  const elapsed = Number(passenger.flight_elapsed_hours);
  const title = document.getElementById("next-action-title");
  const description = document.getElementById("next-action-description");
  const controls = document.getElementById("next-action-controls");
  const icon = document.getElementById("next-action-icon");
  const tcmEvent = schedule.find(event => event.type === "tcm_drink");
  const sleepStart = schedule.find(event => event.type === "sleep_start");
  const coffeeEvent = schedule.find(event => event.type === "caffeine_cutoff");
  const coffeeWindowOpen = coffeeEvent
    && coffeeEvent.hour >= 0
    && elapsed >= coffeeEvent.hour
    && elapsed < coffeeEvent.hour + coffeeEvent.window_hours;
  const tcmWindowOpen = tcmEvent && sleepStart
    && elapsed >= tcmEvent.hour
    && elapsed < sleepStart.hour;
  const coffeeDecision = passenger.coffee_decision;
  const tcmDecision = passenger.tcm_drink_decision;

  let action;
  if (!Number.isFinite(elapsed) || !sleepStart) {
    action = {
      key: "no-schedule",
      title: "No scheduled action",
      description: "A personalized sleep schedule is not available for this seat.",
      icon: "✦",
    };
  } else if (tcmWindowOpen && tcmDecision) {
    action = {
      key: `tcm-${tcmDecision.decision}`,
      title: tcmDecision.decision === "yes" ? "TCM drink requested" : "No TCM drink requested",
      description: tcmDecision.decision === "yes"
        ? "Your drink request has been sent to the cabin crew."
        : "You can continue with your scheduled rest plan.",
      icon: tcmDecision.decision === "yes" ? "🍵" : "✓",
    };
  } else if (tcmWindowOpen) {
    action = {
      key: "tcm-prompt",
      title: "Your scheduled TCM drink",
      description: "Would you like a quick 10-second guided check before choosing a caffeine-free tea?",
      icon: "🍵",
      buttons: [
        ["Yes, start check", () => openTCMGuide(), true],
        ["No, thanks", () => submitTCMDecision("no")],
      ],
    };
  } else if (coffeeWindowOpen && coffeeDecision) {
    action = {
      key: `coffee-${coffeeDecision.decision}`,
      title: coffeeDecision.decision === "yes" ? "Coffee requested" : "No coffee requested",
      description: coffeeDecision.decision === "yes"
        ? "Your coffee request has been sent to the cabin crew."
        : "No coffee order was sent.",
      icon: coffeeDecision.decision === "yes" ? "☕" : "✓",
    };
  } else if (coffeeWindowOpen) {
    action = {
      key: "coffee-prompt",
      title: "Coffee time",
      description: "This is your scheduled coffee window. Would you like the cabin crew to bring coffee?",
      icon: "☕",
      buttons: [
        ["Yes, request coffee", () => submitCoffeeChoice("yes"), true],
        ["No, thanks", () => submitCoffeeChoice("no")],
      ],
    };
  } else {
    const upcoming = [];
    if (tcmEvent && tcmEvent.hour >= 0 && elapsed < tcmEvent.hour && !tcmDecision) {
      upcoming.push({
        hour: tcmEvent.hour,
        key: "tcm-upcoming",
        title: "Next: TCM drink",
        description: `Your scheduled caffeine-free tea option opens ${formatFlightCountdown(tcmEvent.hour, elapsed)}.`,
        icon: "🍵",
      });
    }
    if (
      coffeeEvent
      && coffeeEvent.hour >= 0
      && elapsed < coffeeEvent.hour
      && !coffeeDecision
    ) {
      upcoming.push({
        hour: coffeeEvent.hour,
        key: "coffee-upcoming",
        title: "Next: coffee option",
        description: `Your scheduled coffee request window opens ${formatFlightCountdown(coffeeEvent.hour, elapsed)}.`,
        icon: "☕",
      });
    }
    upcoming.sort((first, second) => first.hour - second.hour);
    action = upcoming[0] || {
      key: "no-action",
      title: "No action due right now",
      description: elapsed < sleepStart.hour
        ? `Your next sleep cycle starts ${formatFlightCountdown(sleepStart.hour, elapsed)}.`
        : "Your scheduled wellness actions for this sleep cycle are complete.",
      icon: "✦",
    };
  }

  title.textContent = action.title;
  description.textContent = action.description;
  icon.textContent = action.icon;
  description.setAttribute("role", "status");

  const signature = action.key;
  if (signature !== lastActionSignature) {
    controls.replaceChildren();
    action.buttons?.forEach(([label, callback, primary]) => {
      controls.appendChild(makeActionButton(label, callback, primary));
    });
    lastActionSignature = signature;
  }
}

function setActionError(error) {
  const description = document.getElementById("next-action-description");
  description.textContent = `Could not send your choice: ${error.message}`;
  description.setAttribute("role", "alert");
}

function setActionButtonsDisabled(disabled) {
  document.querySelectorAll("#next-action-controls button").forEach(button => {
    button.disabled = disabled;
  });
}

async function submitCoffeeChoice(decision) {
  setActionButtonsDisabled(true);
  try {
    currentPassenger.coffee_decision = await submitCoffeeDecision(
      PASSENGER_SEAT,
      decision
    );
    renderRecommendedAction(currentPassenger);
  } catch (error) {
    setActionError(error);
    setActionButtonsDisabled(false);
  }
}

function closeTCMGuide() {
  if (tcmCountdownTimer !== null) {
    window.clearInterval(tcmCountdownTimer);
    tcmCountdownTimer = null;
  }
  document.getElementById("tcm-modal").hidden = true;
  document.body.style.overflow = "";
  if (tcmOpener?.isConnected) tcmOpener.focus();
}

function openTCMGuide() {
  tcmOpener = document.activeElement;
  const modal = document.getElementById("tcm-modal");
  const scanStep = document.getElementById("tcm-scan-step");
  const resultStep = document.getElementById("tcm-result-step");
  const countdown = document.getElementById("sensor-countdown");
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  scanStep.hidden = false;
  resultStep.hidden = true;
  countdown.textContent = "10";
  document.getElementById("cancel-tcm-check").focus();

  let secondsRemaining = 10;
  tcmCountdownTimer = window.setInterval(() => {
    secondsRemaining -= 1;
    countdown.textContent = String(secondsRemaining);
    if (secondsRemaining <= 0) {
      window.clearInterval(tcmCountdownTimer);
      tcmCountdownTimer = null;
      showTCMRecommendation();
    }
  }, 1000);
}

async function showTCMRecommendation() {
  document.getElementById("tcm-scan-step").hidden = true;
  document.getElementById("tcm-result-step").hidden = false;
  const name = document.getElementById("tcm-recommendation-name");
  const reason = document.getElementById("tcm-recommendation-reason");
  const errorMessage = document.getElementById("tcm-recommendation-error");
  const orderButton = document.getElementById("order-tcm-drink");
  const declineButton = document.getElementById("decline-tcm-drink");
  const retryButton = document.getElementById("retry-tcm-recommendation");
  const plan = await getWellness(PASSENGER_SEAT).catch(error => {
    errorMessage.textContent = `Could not load the drink recommendation: ${error.message}`;
    errorMessage.hidden = false;
    name.textContent = "Recommendation unavailable";
    reason.textContent = "";
    orderButton.hidden = true;
    declineButton.hidden = true;
    retryButton.hidden = false;
    return null;
  });
  if (!plan) return;

  const symptom = plan.menus.symptom || "general";
  recommendedTCMDrink = TCM_DRINK_RECOMMENDATIONS[symptom]
    || TCM_DRINK_RECOMMENDATIONS.general;
  name.textContent = recommendedTCMDrink.name;
  reason.textContent = recommendedTCMDrink.reason;
  errorMessage.hidden = true;
  orderButton.hidden = false;
  declineButton.hidden = false;
  retryButton.hidden = true;
  orderButton.textContent = `Yes, order ${recommendedTCMDrink.name}`;
  orderButton.disabled = false;
  declineButton.disabled = false;
}

async function submitTCMDecision(decision) {
  const modalOpen = !document.getElementById("tcm-modal").hidden;
  const orderButton = document.getElementById("order-tcm-drink");
  const declineButton = document.getElementById("decline-tcm-drink");
  if (modalOpen) {
    orderButton.disabled = true;
    declineButton.disabled = true;
  } else {
    setActionButtonsDisabled(true);
  }
  try {
    currentPassenger.tcm_drink_decision = await submitTCMDrinkDecision(
      PASSENGER_SEAT,
      decision,
      decision === "yes" ? recommendedTCMDrink?.name : undefined
    );
    closeTCMGuide();
    renderRecommendedAction(currentPassenger);
  } catch (error) {
    if (modalOpen) {
      document.getElementById("tcm-recommendation-error").textContent =
        `Could not send your choice: ${error.message}`;
      document.getElementById("tcm-recommendation-error").hidden = false;
      orderButton.disabled = false;
      declineButton.disabled = false;
    } else {
      setActionError(error);
      setActionButtonsDisabled(false);
    }
  }
}

document.getElementById("cancel-tcm-check").addEventListener("click", closeTCMGuide);
document.getElementById("order-tcm-drink").addEventListener(
  "click",
  () => submitTCMDecision("yes")
);
document.getElementById("decline-tcm-drink").addEventListener(
  "click",
  () => submitTCMDecision("no")
);
document.getElementById("retry-tcm-recommendation").addEventListener(
  "click",
  showTCMRecommendation
);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !document.getElementById("tcm-modal").hidden) {
    closeTCMGuide();
  }
});

function updatePassengerDashboard(passenger) {
  currentPassenger = passenger;
  const hasStellaFlightHistory = passenger.seat === "2K";
  document.getElementById("stella-flight-history").hidden =
    !hasStellaFlightHistory;
  document.getElementById("no-flight-history").hidden =
    hasStellaFlightHistory;
  // Passenger information
  document.getElementById("flight-number").textContent =
    passenger.flight_id;

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

  const monitoringStatusDot =
    document.getElementById("monitoring-status-dot");

  const monitoringDetail =
    document.getElementById("monitoring-detail");

  const symptom = passenger.reported_symptom;
  const menuRecommendation = {
    fatigue: "RESTORE",
    nausea: "GENTLE",
  }[symptom];

  monitoringStatus.textContent = symptom
    ? `${symptom[0].toUpperCase()}${symptom.slice(1)} reported`
    : passenger.priority === "High"
      ? "Crew review suggested"
      : passenger.priority === "Medium"
        ? "Check-in suggested"
        : "Normal";

  monitoringStatusDot.classList.toggle(
    "alert",
    Boolean(symptom) || passenger.priority !== "Normal"
  );

  document.getElementById("reported-symptom").textContent =
    symptom
      ? menuRecommendation
        ? `Menu recommendation: ${menuRecommendation}`
        : `Reported symptom: ${symptom}`
      : "No symptom reported";

  monitoringDetail.textContent = passenger.flags.length
    ? `${passenger.flags.length} reading(s) flagged for review`
    : "All readings within demo ranges";

  updateSleepCountdown(passenger);
  renderRecommendedAction(passenger);
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

if (wellnessButton && wellnessPanel) {
  wellnessButton.addEventListener("click", async () => {
    const isHidden = wellnessPanel.style.display === "none";

    wellnessPanel.style.display = isHidden ? "block" : "none";

    if (isHidden) {
      await loadWellnessPlan();
    }
  });
}
