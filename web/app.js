(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fmt = (n, digits = 0) => Number(n).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  });
  const litre = (n) => `${fmt(n)} L`;
  const DEMO_RAIN = "0, 5, 12, 0, 0, 18, 4, 0, 25, 0, 8, 0, 15, 2";
  let lastResult = null;
  let rainfallSource = "Manual";

  function getNumber(id) {
    return Number($(id).value);
  }

  function readConfig() {
    const config = {
      roofArea: getNumber("roof-area"),
      capacity: getNumber("tank-capacity"),
      runoff: getNumber("runoff-coefficient"),
      efficiency: getNumber("collection-efficiency"),
      startStorage: getNumber("starting-storage"),
      dailyDemand: getNumber("daily-demand"),
      waterPrice: getNumber("water-price"),
      days: getNumber("simulation-days"),
      rainfall: $("rainfall-series").value.split(",").map(v => v.trim()).filter(v => v !== "").map(Number)
    };

    const errors = [];
    if (!Number.isFinite(config.roofArea) || config.roofArea <= 0) errors.push("Roof area must be greater than 0.");
    if (!Number.isFinite(config.capacity) || config.capacity <= 0) errors.push("Tank capacity must be greater than 0.");
    if (!Number.isFinite(config.runoff) || config.runoff < 0 || config.runoff > 1) errors.push("Runoff coefficient must be between 0 and 1.");
    if (!Number.isFinite(config.efficiency) || config.efficiency < 0 || config.efficiency > 1) errors.push("Collection efficiency must be between 0 and 1.");
    if (!Number.isFinite(config.startStorage) || config.startStorage < 0 || config.startStorage > config.capacity) errors.push("Starting storage must be between 0 and tank capacity.");
    if (!Number.isFinite(config.dailyDemand) || config.dailyDemand < 0) errors.push("Daily demand cannot be negative.");
    if (!Number.isFinite(config.waterPrice) || config.waterPrice < 0) errors.push("Water price cannot be negative.");
    if (!Number.isInteger(config.days) || config.days < 1 || config.days > 365) errors.push("Simulation days must be an integer from 1 to 365.");
    if (!config.rainfall.length) errors.push("Enter at least one daily rainfall value.");
    if (config.rainfall.some(v => !Number.isFinite(v) || v < 0 || v > 2000)) errors.push("Rainfall values must be between 0 and 2,000 mm per day.");
    return { config, errors };
  }

  // Use the C engine through WebAssembly when available. The fallback keeps
  // the project usable before Emscripten has been installed.
  function cCall(name, args) {
    if (window.waterWasmReady && typeof Module !== "undefined" && typeof Module.ccall === "function") {
      const result = Module.ccall(name, "number", args.map(() => "number"), args);
      if (Number.isFinite(result) && result >= 0) return result;
    }
    return null;
  }

  function potentialRunoff(rain, area, coefficient) {
    const wasm = cCall("calculate_potential_runoff", [rain, area, coefficient]);
    return wasm === null ? rain * area * coefficient : wasm;
  }

  function usableInflow(potential, efficiency) {
    const wasm = cCall("calculate_usable_inflow", [potential, efficiency]);
    return wasm === null ? potential * efficiency : wasm;
  }

  function overflow(storage, inflow, capacity) {
    const wasm = cCall("calculate_overflow", [storage, inflow, capacity]);
    return wasm === null ? Math.max(0, storage + inflow - capacity) : wasm;
  }

  function waterUsed(available, demand) {
    const wasm = cCall("calculate_water_used", [available, demand]);
    return wasm === null ? Math.min(available, demand) : wasm;
  }

  function nextStorage(storage, inflow, demand, capacity) {
    const wasm = cCall("calculate_next_storage", [storage, inflow, demand, capacity]);
    if (wasm !== null) return wasm;
    return Math.min(capacity, storage + inflow) - Math.min(Math.min(capacity, storage + inflow), demand);
  }

  function simulate(config) {
    let storage = config.startStorage;
    const rows = [];
    const totals = { potential: 0, inflow: 0, used: 0, overflow: 0, demand: 0, unmet: 0 };
    for (let day = 0; day < config.days; day++) {
      const rainfall = config.rainfall[day % config.rainfall.length];
      const potential = potentialRunoff(rainfall, config.roofArea, config.runoff);
      const inflow = usableInflow(potential, config.efficiency);
      const overflowLitres = overflow(storage, inflow, config.capacity);
      const availableAfterOverflow = Math.min(config.capacity, storage + inflow);
      const used = waterUsed(availableAfterOverflow, config.dailyDemand);
      const unmet = Math.max(0, config.dailyDemand - used);
      const endingStorage = nextStorage(storage, inflow, config.dailyDemand, config.capacity);

      rows.push({
        day: day + 1, rainfall, potential, inflow, used,
        overflow: overflowLitres, demand: config.dailyDemand,
        unmet, startStorage: storage, endingStorage
      });
      totals.potential += potential;
      totals.inflow += inflow;
      totals.used += used;
      totals.overflow += overflowLitres;
      totals.demand += config.dailyDemand;
      totals.unmet += unmet;
      storage = endingStorage;
    }
    return { rows, totals, finalStorage: storage, config };
  }

  function render(result) {
    lastResult = result;
    const { totals, config, rows, finalStorage } = result;
    const coverage = totals.demand > 0 ? (totals.used / totals.demand) * 100 : 100;
    const capacityPct = (finalStorage / config.capacity) * 100;
    const free = Math.max(0, config.capacity - finalStorage);
    const estimatedSavings = totals.used * config.waterPrice;

    $("metric-collected").textContent = litre(totals.inflow);
    $("metric-used").textContent = litre(totals.used);
    $("metric-overflow").textContent = litre(totals.overflow);
    $("metric-coverage").textContent = `${fmt(Math.min(100, coverage), 1)}%`;
    $("tank-litres").textContent = litre(finalStorage);
    $("tank-capacity-label").textContent = `of ${fmt(config.capacity)} L capacity`;
    $("tank-percent").textContent = `${fmt(capacityPct, 1)}%`;
    $("tank-free").textContent = litre(free);
    $("tank-unmet").textContent = litre(totals.unmet);
    $("tank-water").style.height = `${Math.max(0, Math.min(100, capacityPct))}%`;
    $("tank-progress").style.width = `${Math.max(0, Math.min(100, capacityPct))}%`;
    $("simulation-label").textContent = `${config.days}-day scenario`;

    const tankStatus = $("tank-status");
    if (capacityPct >= 90) {
      tankStatus.textContent = "Near capacity";
      tankStatus.className = "pill pill-green";
    } else if (capacityPct <= 20) {
      tankStatus.textContent = "Low storage";
      tankStatus.className = "pill";
    } else {
      tankStatus.textContent = "Healthy level";
      tankStatus.className = "pill pill-green";
    }

    $("engine-status").textContent = window.waterWasmReady ? "C / WebAssembly engine" : "Local simulation · JS fallback";
    renderChart(rows, config.capacity);
    renderTable(rows);
    renderBalance(result, estimatedSavings, coverage);
    renderRecommendations(result, coverage, estimatedSavings);
  }

  function renderChart(rows, capacity) {
    const chart = $("chart");
    chart.replaceChildren();
    const maxRain = Math.max(1, ...rows.map(r => r.rainfall));
    rows.forEach(row => {
      const day = document.createElement("div");
      day.className = "chart-day";
      day.title = `Day ${row.day}: rainfall ${row.rainfall} mm; ending storage ${fmt(row.endingStorage)} L`;
      const area = document.createElement("div");
      area.className = "bar-area";
      const rain = document.createElement("div");
      rain.className = "bar bar-rain";
      rain.style.height = `${Math.max(row.rainfall > 0 ? 3 : 1, (row.rainfall / maxRain) * 100)}%`;
      rain.setAttribute("aria-label", `Rainfall ${row.rainfall} mm`);
      const storage = document.createElement("div");
      storage.className = "bar bar-storage";
      storage.style.height = `${Math.max(row.endingStorage > 0 ? 3 : 1, (row.endingStorage / capacity) * 100)}%`;
      storage.setAttribute("aria-label", `Storage ${fmt(row.endingStorage)} litres`);
      area.append(rain, storage);
      const label = document.createElement("span");
      label.className = "chart-label";
      label.textContent = `D${row.day}`;
      day.append(area, label);
      chart.append(day);
    });
  }

  function renderTable(rows) {
    const tbody = $("results-body");
    tbody.replaceChildren();
    rows.forEach(r => {
      const tr = document.createElement("tr");
      const cells = [
        `Day ${r.day}`, `${fmt(r.rainfall, 1)} mm`, litre(r.inflow),
        litre(r.used), litre(r.overflow), litre(r.unmet), litre(r.endingStorage)
      ];
      cells.forEach(value => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      });
      tbody.append(tr);
    });
  }

  function renderBalance(result, estimatedSavings, coverage) {
    const { totals, config, finalStorage } = result;
    const entries = [
      ["Potential runoff before collection losses", litre(totals.potential)],
      ["Usable collected inflow", litre(totals.inflow)],
      ["Harvested water used", litre(totals.used)],
      ["Overflow estimate", litre(totals.overflow)],
      ["Unmet demand", litre(totals.unmet)],
      ["Final tank storage", litre(finalStorage)],
      ["Demand coverage", `${fmt(Math.min(100, coverage), 1)}%`],
      ["Estimated replacement-water savings", `₹${fmt(estimatedSavings, 2)}`]
    ];
    const box = $("water-balance");
    box.replaceChildren();
    entries.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "balance-row";
      const left = document.createElement("span");
      left.textContent = label;
      const right = document.createElement("strong");
      right.textContent = value;
      row.append(left, right);
      box.append(row);
    });
  }

  function addRecommendation(container, icon, title, description, warning = false) {
    const item = document.createElement("div");
    item.className = "recommendation";
    const iconEl = document.createElement("span");
    iconEl.className = `rec-icon${warning ? " warn" : ""}`;
    iconEl.textContent = icon;
    const content = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const p = document.createElement("p");
    p.textContent = description;
    content.append(strong, p);
    item.append(iconEl, content);
    container.append(item);
  }

  function renderRecommendations(result, coverage, savings) {
    const { totals, config, finalStorage } = result;
    const container = $("recommendations");
    container.replaceChildren();

    if (totals.overflow > 0) {
      addRecommendation(container, "!", "Overflow detected in the scenario",
        `${litre(totals.overflow)} may exceed tank capacity over ${config.days} days. Compare a larger tank or ensure a professionally designed safe overflow/recharge route.`, true);
    } else {
      addRecommendation(container, "✓", "No simulated overflow",
        "The selected tank contained all modelled inflow in this scenario. Test heavier rainfall before choosing a real tank size.");
    }

    if (totals.unmet > 0) {
      addRecommendation(container, "↓", "Demand exceeds available harvested water",
        `${litre(totals.unmet)} of demand is unmet in the model. Consider conservation, a different tank size or a reliable backup supply.`, true);
    } else {
      addRecommendation(container, "✓", "Demand fully covered in this scenario",
        "Harvested water met all modelled demand. Verify this with longer dry-period simulations before relying on the system.");
    }

    const capacityPct = finalStorage / config.capacity;
    if (capacityPct > 0.8) {
      addRecommendation(container, "↗", "Limited free storage at the end",
        `${litre(config.capacity - finalStorage)} of capacity remains. If more rain is expected, review the forecast and safe overflow plan.`);
    } else if (capacityPct < 0.2) {
      addRecommendation(container, "＋", "Storage reserve is low",
        "Review demand and dry-spell scenarios. Do not treat simulated water availability as a guarantee of supply.");
    } else {
      addRecommendation(container, "i", "Review multiple weather scenarios",
        "Test dry, typical and wet periods and compare tank sizes before making a design decision.");
    }

    addRecommendation(container, "₹", "Estimated replacement-water value",
      `Approximately ₹${fmt(savings, 2)} at the configured price. This is a simplified estimate, not a return-on-investment calculation.`);
  }


  // Open-Meteo forecast integration: no API key is needed for standard use.
  function formatDate(isoDate) {
    const date = new Date(`${isoDate}T12:00:00`);
    return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }

  function renderWeatherForecast(dates, rainfall) {
    const box = $("weather-forecast");
    box.replaceChildren();
    dates.forEach((date, index) => {
      const item = document.createElement("div");
      item.className = "weather-day";
      const day = document.createElement("span");
      day.className = "weather-day-name";
      day.textContent = formatDate(date);
      const amount = document.createElement("strong");
      amount.textContent = `${fmt(rainfall[index], 1)} mm`;
      const note = document.createElement("small");
      note.textContent = rainfall[index] === 0 ? "No rain forecast" : "Forecast rainfall";
      item.append(day, amount, note);
      box.append(item);
    });
  }

  async function fetchWeatherForecast() {
    const button = $("fetch-weather");
    const status = $("weather-status");
    const message = $("weather-message");
    const lat = Number($("weather-lat").value);
    const lon = Number($("weather-lon").value);
    const days = Number($("weather-days").value);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180) {
      message.textContent = "Enter a valid latitude (-90 to 90) and longitude (-180 to 180).";
      status.textContent = "Check coordinates";
      return;
    }

    button.disabled = true;
    button.textContent = "Fetching forecast…";
    status.textContent = "Connecting";
    message.textContent = "Requesting the latest daily rainfall forecast from Open-Meteo…";

    try {
      const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        daily: "precipitation_sum",
        forecast_days: String(days),
        timezone: "auto"
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
      if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}.`);
      const data = await response.json();
      const dates = data?.daily?.time;
      const precipitation = data?.daily?.precipitation_sum;
      if (!Array.isArray(dates) || !Array.isArray(precipitation) || dates.length === 0 ||
        dates.length !== precipitation.length) {
        throw new Error("The weather service returned an unexpected response.");
      }

      const safeRainfall = precipitation.map(value => {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? Math.min(2000, n) : 0;
      });
      $("rainfall-series").value = safeRainfall.map(v => Number(v.toFixed(1))).join(", ");
      $("simulation-days").value = String(safeRainfall.length);
      renderWeatherForecast(dates, safeRainfall);
      rainfallSource = "Open-Meteo";
      runSimulation();
      status.textContent = "Forecast loaded";
      message.textContent = `Loaded ${safeRainfall.length} days of forecast rainfall. The simulation has been rerun using these values.`;
    } catch (error) {
      status.textContent = "Unavailable";
      message.textContent = `Could not load the forecast: ${error.message} Check your internet connection and try again. The previous rainfall data has been kept.`;
    } finally {
      button.disabled = false;
      button.innerHTML = 'Fetch rainfall forecast <span>↗</span>';
    }
  }

  function runSimulation(event) {
    if (event) event.preventDefault();
    const { config, errors } = readConfig();
    $("form-error").textContent = errors.join(" ");
    if (errors.length) return;
    render(simulate(config));
  }


  function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  async function saveSimulation() {
    const button = $("save-button");
    const status = $("save-status");

    if (!lastResult) {
      status.textContent = "Please run a simulation first.";
      return;
    }

    const simulationName = $("simulation-name").value.trim();

    if (!simulationName) {
      status.textContent = "Please enter a simulation name.";
      $("simulation-name").focus();
      return;
    }

    button.disabled = true;
    status.textContent = "Saving simulation to MySQL...";

    try {
      const result = lastResult;

      const payload = {
        simulation_name: simulationName,
        start_date: getLocalDateString(),
        rainfall_source: rainfallSource,

        config: {
          roofArea: result.config.roofArea,
          capacity: result.config.capacity,
          runoff: result.config.runoff,
          efficiency: result.config.efficiency,
          startStorage: result.config.startStorage,
          dailyDemand: result.config.dailyDemand
        },

        rows: result.rows.map(row => ({
          rainfall: row.rainfall,
          potential: row.potential,
          inflow: row.inflow,
          used: row.used,
          overflow: row.overflow,
          demand: row.demand,
          unmet: row.unmet,
          startStorage: row.startStorage,
          endingStorage: row.endingStorage
        }))
      };

      const response = await fetch(
        "http://localhost:5000/api/simulations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      const responseText = await response.text();

      console.log("HTTP Status:", response.status);
      console.log("Server Response:", responseText);

      let data;

      try {
        data = JSON.parse(responseText);
      } catch (error) {
        throw new Error("Server returned HTML instead of JSON. Check the browser console.");
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to save simulation.");
      }

      status.textContent =
        `Successfully saved! Simulation ID: ${data.simulation_id}. ` +
        `${data.total_days} daily records stored in MySQL.`;

    } catch (error) {
      console.error("Save simulation error:", error);

      status.textContent =
        `Could not save simulation: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }


  function loadSample() {
    rainfallSource = "Manual";
    $("roof-area").value = 1000;
    $("tank-capacity").value = 10000;
    $("runoff-coefficient").value = 0.85;
    $("collection-efficiency").value = 0.9;
    $("starting-storage").value = 2000;
    $("daily-demand").value = 2500;
    $("water-price").value = 0.05;
    $("simulation-days").value = 14;
    $("rainfall-series").value = DEMO_RAIN;
    runSimulation();
  }

  function exportCsv() {
    if (!lastResult) return;
    const header = ["day", "rainfall_mm", "potential_runoff_l", "usable_inflow_l", "demand_l", "water_used_l", "overflow_l", "unmet_demand_l", "starting_storage_l", "ending_storage_l"];
    const lines = [header.join(",")];
    lastResult.rows.forEach(r => {
      lines.push([r.day, r.rainfall, r.potential, r.inflow, r.demand, r.used, r.overflow, r.unmet, r.startStorage, r.endingStorage].join(","));
    });
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rainwise-simulation-results.csv";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  $("config-form").addEventListener("submit", runSimulation);
  $("fetch-weather").addEventListener("click", fetchWeatherForecast);
  $("sample-button").addEventListener("click", loadSample);
  $("reset-button").addEventListener("click", loadSample);
  $("export-button").addEventListener("click", exportCsv);
  $("save-button").addEventListener("click", saveSimulation);
  document.addEventListener("water-wasm-ready", () => {
    $("engine-status").textContent = "C / WebAssembly engine";
    if (lastResult) runSimulation();
  });

  function formatHistoryDate(dateValue) {
    if (!dateValue) return "—";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  async function loadSimulationHistory() {
    const status = $("history-status");
    const list = $("history-list");
    const button = $("refresh-history");

    if (!status || !list) return;

    if (button) button.disabled = true;

    status.textContent = "Loading saved simulations...";

    try {
      const response = await fetch("http://localhost:5000/api/simulations");
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load simulation history.");
      }

      if (!data.simulations || data.simulations.length === 0) {
        status.textContent = "No saved simulations yet. Run and save a simulation first.";
        list.innerHTML = "";
        return;
      }

      status.textContent = `${data.count} saved simulation(s) found.`;

      list.innerHTML = data.simulations.map(sim => `
            <article class="history-card">
                <div class="history-card-heading">
                    <div>
                        <h3>${escapeHtml(sim.simulation_name)}</h3>
                        <p>Simulation #${Number(sim.simulation_id)} · ${escapeHtml(sim.building_name || "GEHU Academic Block")}</p>
                    </div>

                    <div class="history-actions">

    <button class="button button-primary view-history-button"
        type="button"
        data-simulation-id="${Number(sim.simulation_id)}">
        View Details
    </button>

    <button class="button button-outline export-history-button"
        type="button"
        data-simulation-id="${Number(sim.simulation_id)}">
        Export PDF
    </button>

    <button class="button button-outline delete-history-button"
        type="button"
        data-simulation-id="${Number(sim.simulation_id)}">
        Delete
    </button>

</div>
</div>
                </div>

                <div class="history-stats">
                    <div><span>Period</span><strong>${formatHistoryDate(sim.start_date)} – ${formatHistoryDate(sim.end_date)}</strong></div>
                    <div><span>Total rainfall</span><strong>${Number(sim.total_rainfall_mm).toLocaleString("en-IN")} mm</strong></div>
                    <div><span>Water collected</span><strong>${Number(sim.total_collected_l).toLocaleString("en-IN")} L</strong></div>
                    <div><span>Water used</span><strong>${Number(sim.total_water_used_l).toLocaleString("en-IN")} L</strong></div>
                    <div><span>Overflow</span><strong>${Number(sim.total_overflow_l).toLocaleString("en-IN")} L</strong></div>
                    <div><span>Final storage</span><strong>${Number(sim.final_storage_l).toLocaleString("en-IN")} L</strong></div>
                </div>

                <div class="history-details" id="history-details-${Number(sim.simulation_id)}" hidden></div>
            </article>
        `).join("");

    } catch (error) {
      console.error("History loading error:", error);
      status.textContent = `Could not load history: ${error.message}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function viewSimulationDetails(simulationId) {
    const container = $(`history-details-${simulationId}`);

    if (!container) return;

    if (!container.hidden) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    container.innerHTML = "<p>Loading daily results...</p>";

    try {
      const response = await fetch(`http://localhost:5000/api/simulations/${simulationId}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load simulation details.");
      }

      const rows = data.daily_results || [];

      container.innerHTML = `
            <h4>Daily Results</h4>

            <div class="history-table-wrap">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Rainfall (mm)</th>
                            <th>Collected (L)</th>
                            <th>Used (L)</th>
                            <th>Overflow (L)</th>
                            <th>Closing storage (L)</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                <td>${formatHistoryDate(row.result_date)}</td>
                                <td>${Number(row.rainfall_mm).toLocaleString("en-IN")}</td>
                                <td>${Number(row.collected_l).toLocaleString("en-IN")}</td>
                                <td>${Number(row.water_used_l).toLocaleString("en-IN")}</td>
                                <td>${Number(row.overflow_l).toLocaleString("en-IN")}</td>
                                <td>${Number(row.closing_storage_l).toLocaleString("en-IN")}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;

    } catch (error) {
      console.error("Details loading error:", error);
      container.innerHTML = `<p>Could not load details: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function deleteSimulation(simulationId) {
    const confirmed = confirm(
      "Are you sure you want to delete this simulation? Its daily records will also be deleted permanently."
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `http://localhost:5000/api/simulations/${simulationId}`,
        {
          method: "DELETE"
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not delete simulation.");
      }

      alert("Simulation deleted successfully!");

      await loadSimulationHistory();

    } catch (error) {
      console.error("Delete simulation error:", error);
      alert(`Error: ${error.message}`);
    }
  }

  // Export Simulation as PDF
  async function exportSimulationPDF(simulationId) {
    // Open the print window immediately to avoid popup blocking
    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      alert("Please allow popups for this website to export the PDF.");
      return;
    }

    printWindow.document.write("<h2>Preparing RainWise report...</h2>");

    try {
      const response = await fetch(
        `http://localhost:5000/api/simulations/${simulationId}`
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load simulation.");
      }

      const sim = data.simulation || data.summary || data;
      const rows = data.daily_results || [];

      const dailyRows = rows.map(row => `
            <tr>
                <td>${formatHistoryDate(row.result_date)}</td>
                <td>${Number(row.rainfall_mm).toLocaleString("en-IN")}</td>
                <td>${Number(row.collected_l).toLocaleString("en-IN")}</td>
                <td>${Number(row.water_used_l).toLocaleString("en-IN")}</td>
                <td>${Number(row.overflow_l).toLocaleString("en-IN")}</td>
                <td>${Number(row.closing_storage_l).toLocaleString("en-IN")}</td>
            </tr>
        `).join("");

      printWindow.document.open();

      printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>RainWise Simulation Report</title>

                <style>
                    body {
                        font-family: Arial, sans-serif;
                        padding: 30px;
                        color: #222;
                    }

                    h1 {
                        color: #176b55;
                        margin-bottom: 5px;
                    }

                    h2 {
                        margin-top: 28px;
                        border-bottom: 2px solid #176b55;
                        padding-bottom: 8px;
                    }

                    .subtitle {
                        color: #666;
                    }

                    .summary {
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 12px;
                        margin-top: 20px;
                    }

                    .item {
                        border: 1px solid #ddd;
                        padding: 12px;
                        border-radius: 6px;
                    }

                    .item span {
                        display: block;
                        color: #666;
                        font-size: 12px;
                        margin-bottom: 6px;
                    }

                    .item strong {
                        font-size: 16px;
                    }

                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 15px;
                        font-size: 11px;
                    }

                    th, td {
                        border: 1px solid #ccc;
                        padding: 8px 5px;
                        text-align: center;
                    }

                    th {
                        background: #e8f3ef;
                    }

                    @media print {
                        body {
                            padding: 10px;
                        }

                        button {
                            display: none;
                        }
                    }
                </style>
            </head>

            <body>
                <h1>RainWise</h1>
                <p class="subtitle">
                    Smart Rainwater Harvesting & Management System
                </p>

                <h2>Simulation Report</h2>

                <p><strong>Simulation:</strong>
                    ${escapeHtml(sim.simulation_name || "Rainwater Simulation")}
                </p>

                <p><strong>Building:</strong>
                    ${escapeHtml(sim.building_name || "GEHU Academic Block")}
                </p>

                <p><strong>Tank:</strong>
                    ${escapeHtml(sim.tank_name || "Main Rainwater Tank")}
                </p>

                <p><strong>Period:</strong>
                    ${formatHistoryDate(sim.start_date)} –
                    ${formatHistoryDate(sim.end_date)}
                </p>

                <h2>Simulation Summary</h2>

                <div class="summary">
                    <div class="item">
                        <span>Total Rainfall</span>
                        <strong>${Number(sim.total_rainfall_mm).toLocaleString("en-IN")} mm</strong>
                    </div>

                    <div class="item">
                        <span>Water Collected</span>
                        <strong>${Number(sim.total_collected_l).toLocaleString("en-IN")} L</strong>
                    </div>

                    <div class="item">
                        <span>Water Used</span>
                        <strong>${Number(sim.total_water_used_l).toLocaleString("en-IN")} L</strong>
                    </div>

                    <div class="item">
                        <span>Overflow</span>
                        <strong>${Number(sim.total_overflow_l).toLocaleString("en-IN")} L</strong>
                    </div>

                    <div class="item">
                        <span>Unmet Demand</span>
                        <strong>${Number(sim.unmet_demand_l).toLocaleString("en-IN")} L</strong>
                    </div>

                    <div class="item">
                        <span>Final Tank Storage</span>
                        <strong>${Number(sim.final_storage_l).toLocaleString("en-IN")} L</strong>
                    </div>
                </div>

                <h2>Daily Simulation Results</h2>

                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Rainfall (mm)</th>
                            <th>Collected (L)</th>
                            <th>Used (L)</th>
                            <th>Overflow (L)</th>
                            <th>Closing Storage (L)</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${dailyRows}
                    </tbody>
                </table>

                <p style="margin-top:30px; font-size:11px; color:#777;">
                    Generated by RainWise Smart Rainwater Harvesting System.
                </p>

                <button onclick="window.print()">Print / Save as PDF</button>
            </body>
            </html>
        `);

      printWindow.document.close();
      printWindow.focus();

    } catch (error) {
      console.error("PDF export error:", error);
      printWindow.document.body.innerHTML =
        `<h2>Could not generate report</h2><p>${escapeHtml(error.message)}</p>`;
    }
  }

  if ($("refresh-history")) {
    $("refresh-history").addEventListener("click", loadSimulationHistory);
  }

  if ($("history-list")) {
    $("history-list").addEventListener("click", event => {

      const viewButton = event.target.closest(".view-history-button");
      const deleteButton = event.target.closest(".delete-history-button");
      const exportButton = event.target.closest(".export-history-button");

      if (viewButton) {
        viewSimulationDetails(Number(viewButton.dataset.simulationId));
      }

      if (deleteButton) {
        deleteSimulation(Number(deleteButton.dataset.simulationId));
      }

      if (exportButton) {
        exportSimulationPDF(Number(exportButton.dataset.simulationId));
      }

    });
  }

  loadSimulationHistory();
  // Initial dashboard demo.
  runSimulation();
})();
