/* Browser interface: connect inputs to the scheduling model and display its results.
 * This file also handles local saving, scenario import/export and the CSV download.
 */
(() => {
  "use strict";
  const { CROP_NAMES, makeScenario, compute, validateState } =
    globalThis.TractorModel;
  const $ = (id) => document.getElementById(id);

  const STORE_KEY = "tractor-sequencer-v2";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const money = (x) => "₦" + Math.round(x).toLocaleString("en-NG");
  const number = (x, d = 2) =>
    x.toLocaleString("en-NG", { maximumFractionDigits: d });
  let state = makeScenario("pitch"),
    view = "overview",
    result,
    editId = null,
    toastTimer,
    pendingConfirm = null,
    storageOK = true;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) state = validateState(JSON.parse(saved));
  } catch (e) {
    storageOK = false;
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageOK = true;
    } catch (e) {
      storageOK = false;
    }
    $("saveStatus").textContent = storageOK
      ? "Saved on this device"
      : "Local saving unavailable. Save a file from Bookings.";
  }
  function toast(message, action) {
    clearTimeout(toastTimer);
    const box = $("toast");
    box.replaceChildren(document.createTextNode(message));
    if (action) {
      const b = document.createElement("button");
      b.textContent = "Undo";
      b.onclick = () => {
        action();
        box.hidden = true;
      };
      box.append(b);
    }
    box.hidden = false;
    toastTimer = setTimeout(() => (box.hidden = true), action ? 10000 : 5500);
  }
  function markChanged() {
    state.scenario = "custom";
    save();
    render();
  }
  function switchView(next) {
    view = next;
    for (const k of ["overview", "farm", "model"])
      $(k + "View").hidden = k !== next;
    document
      .querySelectorAll(".nav button")
      .forEach((b) =>
        b.getAttribute("data-view") === next
          ? b.setAttribute("aria-current", "page")
          : b.removeAttribute("aria-current"),
      );
    const titles = {
      overview: ["Schedule", "Ploughing schedule"],
      farm: ["Bookings", "Farm bookings"],
      model: ["Settings", "Settings"],
    };
    $("crumbView").textContent = titles[next][0];
    $("pageTitle").textContent = titles[next][1];
    $("scenarioPicker").hidden = next !== "overview";
    $("exportCSV").hidden = next !== "overview";
    $("addTop").hidden = next === "model";
  }
  function syncInputs() {
    for (const k of ["capacity", "hours", "travel", "cap"])
      $(k).value = state.settings[k];
    document
      .querySelectorAll("input[name=mode]")
      .forEach((el) => (el.checked = el.value === state.settings.mode));
    $("scenario").value = state.scenario;
  }
  /** Read current model results, then display them. All scheduling maths belongs in model.js. */
  function render() {
    result = compute(state);
    syncInputs();
    const r = result,
      isCap = state.settings.mode === "cap",
      label = isCap ? "Priority with fairness" : "Priority schedule";
    $("fcfsLoss").textContent = money(r.fcfs.loss);
    $("ruleLoss").textContent = money(r.selected.loss);
    $("saving").textContent = money(r.saving);
    $("savePercent").textContent =
      r.fcfs.loss > 0 ? number(r.percent, 1) + "%" : "";
    $("selectedLabel").textContent = isCap
      ? "With delay limit"
      : "Priority order";
    const first = r.selected.rows[0];
    $("nextName").textContent = first ? first.name : "No bookings";
    $("nextMeta").textContent = first
      ? first.crop +
        " · " +
        number(first.area) +
        " ha · " +
        number(first.p) +
        " tractor hours"
      : "Add a farm to plan the first job.";
    $("nextReason").hidden = !first;
    if (first) $("nextReason").dataset.detail = first.id;
    $("capField").hidden = !isCap;
    $("fairnessStatus").textContent = first
      ? "Largest extra delay vs booking order: " + dayCount(r.maxShift) + "."
      : "";
    $("campaignSummary").textContent =
      state.farms.length +
      " " +
      (state.farms.length === 1 ? "farm" : "farms") +
      " · " +
      number(r.totalArea) +
      " ha · " +
      dayCount(r.fcfs.duration) +
      " in total";

    const outOfRange =
      r.selected.rows.some((j) => state.crops[j.crop].k * j.finish > 1) ||
      r.fcfs.rows.some((j) => state.crops[j.crop].k * j.finish > 1);
    $("warning").hidden = !outOfRange;
    $("warning").textContent = outOfRange
      ? "These inputs produce a linear loss estimate above 100% of crop value for at least one farm. The scenario is beyond the useful range of this simple model. Review the queue and assumptions."
      : "";
    $("legend").innerHTML = CROP_NAMES.map(
      (c) => `<span><i data-crop-colour="${c}"></i>${c}</span>`,
    ).join("");
    renderTimeline();
    renderSchedule();
    renderFarms();
    renderCrops();
    $("printAssumptions").textContent =
      `Mode: ${label}. Capacity: ${state.settings.capacity} ha/h; working hours: ${state.settings.hours} h/day; travel/setup: ${state.settings.travel} h/job. ${isCap ? "Maximum extra completion delay: " + state.settings.cap + " days. " : ""}Synthetic/entered inputs; linear loss; all farms ready at day 0; fixed travel; planting follows land preparation. Day 0 is the start of work. Estimated outcomes only.`;
    $("exportCSV").disabled = !state.farms.length;
    document
      .querySelectorAll("[data-add],#addTop")
      .forEach((b) => (b.disabled = state.farms.length >= 200));
  }
  function renderTimeline() {
    const r = result,
      total = r.fcfs.duration;
    if (!total) {
      $("timeline").innerHTML =
        '<div class="empty">Your schedule will appear here once you add a farm.</div>';
      return;
    }
    const row = (label, rows) =>
      `<div class="time-row"><div class="time-label">${label}</div><div class="time-strip">${rows.map((j) => `<button class="time-job" data-detail="${j.id}" data-crop-colour="${j.crop}" style="width:${(100 * (j.finish - j.start)) / total}%" title="${esc(j.name)}: day ${number(j.start)} to ${number(j.finish)}" aria-label="${esc(j.name)}, ${j.crop}, starts day ${number(j.start)}, finishes day ${number(j.finish)}"><span>${j.id}</span></button>`).join("")}</div></div>`;
    $("timeline").innerHTML =
      `<div class="time-inner"><div class="time-axis">${Array.from({ length: 6 }, (_, i) => `<span style="left:${i * 20}%">${number((total * i) / 5, 1)} d</span>`).join("")}</div>${row("Booking order", r.fcfs.rows)}${row("Selected order", r.selected.rows)}</div><div class="timeline-note">Both schedules use ${number(total * state.settings.hours)} tractor hours. Day 0 is the start of work.</div>`;
  }
  function changeLabel(n) {
    return Math.abs(n) < 1e-8
      ? '<span class="muted">Unchanged</span>'
      : `<span class="shift ${n < 0 ? "earlier" : "later"}">${number(Math.abs(n))} d ${n < 0 ? "earlier" : "later"}</span>`;
  }
  function cropTag(c) {
    return `<span class="crop" data-crop-colour="${c}">${c}</span>`;
  }
  function renderSchedule() {
    const term = $("scheduleSearch").value.trim().toLowerCase(),
      rows = result.selected.rows.filter((j) =>
        (j.name + " " + j.id + " " + j.crop).toLowerCase().includes(term),
      );
    $("scheduleBody").innerHTML = rows
      .map(
        (j) =>
          `<tr><td><span class="rank">${j.rank}</span></td><td><strong>${esc(j.name)}</strong><span class="farm-id">${esc(j.crop)} · ${number(j.area)} ha</span><span class="phone-shift">${changeLabel(j.shift)}</span></td><td>${number(j.p)} h</td><td>${number(j.finish)}</td><td>${changeLabel(j.shift)}</td><td><button class="text-btn" data-detail="${j.id}" aria-label="Explain priority for ${esc(j.name)}">Why here?</button></td></tr>`,
      )
      .join("");
    if (!rows.length && state.farms.length)
      $("scheduleBody").innerHTML =
        '<tr><td colspan="6" class="empty">No farms match your search.</td></tr>';
    $("scheduleEmpty").hidden = state.farms.length > 0;
    $("scheduleCount").textContent =
      `${rows.length} of ${state.farms.length} farms shown`;
  }
  function renderFarms() {
    $("farmBody").innerHTML = result.fcfs.rows
      .map(
        (j, i) =>
          `<tr><td><span class="rank">${i + 1}</span></td><td><strong>${esc(j.name)}</strong></td><td>${cropTag(j.crop)}</td><td>${number(j.area)}</td><td><div class="row-actions"><button class="icon-btn" data-move="${j.id}" data-direction="-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(j.name)} earlier in booking order">↑</button><button class="icon-btn" data-move="${j.id}" data-direction="1" ${i === state.farms.length - 1 ? "disabled" : ""} aria-label="Move ${esc(j.name)} later in booking order">↓</button></div></td><td><div class="row-actions"><button class="icon-btn" data-edit="${j.id}">Edit</button><button class="icon-btn" data-delete="${j.id}" aria-label="Remove ${esc(j.name)}">Remove</button></div></td></tr>`,
      )
      .join("");
    $("farmEmpty").hidden = state.farms.length > 0;
    $("bookingCount").textContent =
      `${state.farms.length} farms · ${number(result.totalArea)} ha total`;
  }
  // Internal K remains a fraction. The booking officer enters a percentage.
  function cropInputValue(c, k) {
    return k === "k"
      ? Number((state.crops[c][k] * 100).toPrecision(15))
      : state.crops[c][k];
  }
  function renderCrops() {
    if ($("cropBody").children.length) {
      for (const input of $("cropBody").querySelectorAll("input[data-crop]"))
        input.value = cropInputValue(input.dataset.crop, input.dataset.param);
      return;
    }
    $("cropBody").innerHTML = CROP_NAMES.map(
      (c) =>
        `<tr><td>${cropTag(c)}</td>${["k", "y", "p"].map((k) => `<td><input type="number" min="0" max="${k === "k" ? 100 : k === "y" ? 1000 : 1e9}" step="any" required value="${cropInputValue(c, k)}" data-crop="${c}" data-param="${k}" aria-label="${c} ${k === "k" ? "daily loss percentage" : k === "y" ? "yield tonnes per hectare" : "price naira per tonne"}"></td>`).join("")}</tr>`,
    ).join("");
  }
  function openFarm(id = null) {
    editId = id;
    const f = state.farms.find((j) => j.id === id);
    $("farmDialogTitle").textContent = f ? "Edit farm" : "Add a farm";
    $("farmName").value = f
      ? f.name
      : "Farm " + String(state.nextId).padStart(2, "0");
    $("farmCrop").innerHTML = CROP_NAMES.map(
      (c) =>
        `<option${c === (f?.crop || "Maize") ? " selected" : ""}>${c}</option>`,
    ).join("");
    $("farmArea").value = f?.area || 1;
    $("farmDialog").showModal();
  }
  const ordinal = (n) =>
    n +
    (n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  function dayCount(days) {
    const n = number(days);
    return n + " working " + (n === "1" ? "day" : "days");
  }
  function amountChanged(value) {
    return value > 0 && value < 1 ? "less than ₦1" : money(value);
  }

  // Explain actual choices in this run. Comparing adjacent jobs leaves every
  // other farm's finish unchanged. A cap may prevent the cheaper pair order.
  function positionReason(job) {
    const order = result.selected.rows,
      index = job.rank - 1,
      capMode = state.settings.mode === "cap";
    if (order.length === 1) return { text: "This is the only booking." };
    if (capMode && result.fallback)
      return {
        text: "The planner retained booking order to meet the delay limit without increasing total estimated loss.",
      };
    const ranks = new Map(result.smith.rows.map((row) => [row.id, row.rank]));
    if (capMode) {
      // At any step, the algorithm only skips a higher-ranked ready job if
      // choosing it would leave no way to finish all remaining jobs by their limits.
      const remaining = order.slice(index);
      const top = remaining.reduce((a, b) =>
        ranks.get(a.id) < ranks.get(b.id) ? a : b,
      );

      if (top.id !== job.id) {
        const deadline = job.baseFinish + state.settings.cap;
        const earliestAfter =
          job.start + (top.p + job.p) / state.settings.hours;
        const text =
          earliestAfter > deadline + 1e-8
            ? "Serving " +
              top.name +
              " here would push " +
              job.name +
              " past its limit, even if it came immediately afterwards."
            : "Serving " +
              top.name +
              " here would leave too little time to keep every booking within its delay limit.";
        return {
          text,
          note:
            "Without the delay limit, " +
            job.name +
            " would be " +
            ordinal(ranks.get(job.id)) +
            ".",
        };
      }
      if (ranks.get(job.id) < job.rank) {
        const earlier = order
          .slice(0, index)
          .find((row) => ranks.get(row.id) > ranks.get(job.id));
        if (earlier)
          return {
            text:
              job.name +
              " could not take " +
              earlier.name +
              "’s slot without breaking a booking’s delay limit.",
            note:
              "Without the limit, " +
              job.name +
              " would be " +
              ordinal(ranks.get(job.id)) +
              ".",
          };
      }
    }
    const before = index === 0 ? job : order[index - 1],
      after = index === 0 ? order[1] : job;
    const current = (after.w * before.p) / state.settings.hours,
      reversed = (before.w * after.p) / state.settings.hours;
    const extra = reversed - current;
    if (before.priority === after.priority && before.booking < after.booking) {
      if (job.w === 0 && result.smith.rows.every((r) => r.w === 0))
        return {
          text: "All daily loss estimates are zero, so the planner keeps booking order.",
        };
      return {
        text:
          before.name +
          " and " +
          after.name +
          " have the same priority. " +
          before.name +
          " booked earlier.",
      };
    }
    if (extra > 0) {
      const whatIf =
        index === 0
          ? "Serving " + after.name + " first instead"
          : "Moving " + job.name + " ahead of " + before.name;
      return {
        text:
          whatIf +
          " would increase the two farms’ combined estimated loss by " +
          amountChanged(extra) +
          ".",
        pair: { before, after, current, reversed },
      };
    }
    // Includes a constrained neighbouring pair that is not in Smith order.
    return {
      text: capMode
        ? "This order keeps all bookings inside the agreed delay limit."
        : "Swapping this farm with its neighbour makes no material difference to estimated loss.",
    };
  }

  function showDetail(id) {
    const job = result.selected.rows.find((r) => r.id === id);
    if (!job) return;
    const reason = positionReason(job),
      c = state.crops[job.crop],
      delta = Math.abs(job.shift);
    const move =
      job.rank === job.booking
        ? "Stays " + ordinal(job.rank) + " in the queue"
        : "Booked " +
          ordinal(job.booking) +
          " · Scheduled " +
          ordinal(job.rank);
    const effect =
      delta < 1e-8
        ? "Finishes at the same time as in booking order."
        : "Finishes " +
          (delta < 0.01 ? "less than 0.01 working days" : dayCount(delta)) +
          (job.shift < 0 ? " earlier" : " later") +
          " than in booking order.";
    $("detailTitle").textContent = job.name;
    $("detailMeta").textContent = job.crop + " · " + number(job.area) + " ha";
    let pairHTML = "";
    if (reason.pair) {
      const { before, after, current, reversed } = reason.pair;
      pairHTML = `<p class="pair-math">Estimated loss while waiting for the other job:</p><dl class="calc-lines"><div><dt>${esc(before.name)} first</dt><dd>${money(current)}</dd></div><div><dt>${esc(after.name)} first</dt><dd>${money(reversed)}</dd></div></dl>`;
    }
    $("detailBody").innerHTML = `
      <h3 class="move-title">${esc(move)}</h3>
      <p class="position-reason" id="detailReason">${esc(reason.text)}${reason.note ? " " + esc(reason.note) : ""}</p>
      <p class="finish-effect">${esc(effect)}</p>
      <details class="detail-math"><summary>Show calculation</summary><div>
        <dl class="calc-lines"><div><dt>Estimated daily loss</dt><dd>${money(job.w)}/day</dd></div><div><dt>Tractor time</dt><dd>${number(job.p, 4)} h</dd></div><div><dt>Priority (daily loss ÷ tractor hours)</dt><dd>${number(job.priority)}</dd></div></dl>
        <p class="calc-inputs">Daily loss uses ${number(job.area)} ha, ${number(c.y)} t/ha, ${money(c.p)}/t and ${number(c.k * 100, 4)}% loss per day.</p>${pairHTML}
      </div></details>`;
    $("detailDialog").showModal();
  }

  function confirmChange(message, callback) {
    pendingConfirm = callback;
    $("confirmText").textContent = message;
    $("confirmDialog").showModal();
  }
  function downloadFile(filename, text, type) {
    const u = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  }
  function csvCell(v) {
    let t = String(v);
    if (typeof v === "string" && /^[=+@\-\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }
  function exportCSV() {
    const rows = [
      ["Tractor Sequencer: estimated results"],
      ["Scenario", state.scenario],
      [
        "Mode",
        state.settings.mode === "cap"
          ? "Priority with fairness"
          : "Smith priority",
      ],
      ["Capacity ha/h", state.settings.capacity],
      ["Working hours/day", state.settings.hours],
      ["Travel/setup hours/job", state.settings.travel],
      [
        "Allowed extra completion delay (days)",
        state.settings.mode === "cap" ? state.settings.cap : "Not applied",
      ],
      ["FCFS estimated loss NGN", result.fcfs.loss],
      ["Selected estimated loss NGN", result.selected.loss],
      ["Estimated saving NGN", result.saving],
      ["Estimated reduction percent", result.percent],
      [],
      ["Crop", "K per day", "Yield tonnes/ha", "Price NGN/tonne"],
      ...CROP_NAMES.map((c) => [
        c,
        state.crops[c].k,
        state.crops[c].y,
        state.crops[c].p,
      ]),
      [],
      [
        "Selected order",
        "Farm ID",
        "Farm name",
        "Crop",
        "Area ha",
        "Booking position",
        "Job hours",
        "Daily loss NGN",
        "Priority score",
        "FCFS finish day",
        "Selected start day",
        "Selected finish day",
        "Extra delay days",
        "FCFS estimated loss NGN",
        "Selected estimated loss NGN",
      ],
      ...result.selected.rows.map((j) => [
        j.rank,
        j.id,
        j.name,
        j.crop,
        j.area,
        j.booking,
        j.p,
        j.w,
        j.priority,
        j.baseFinish,
        j.start,
        j.finish,
        j.shift,
        result.baseById.get(j.id).loss,
        j.loss,
      ]),
      [],
      [
        "Assumptions",
        "Synthetic/entered data; linear loss; all farms ready at day 0; fixed travel/setup; completion triggers planting. Day 0 is the start of work. Not measured farm outcomes.",
      ],
      [
        "Coefficient context",
        "Default rice, maize and soybean K values are historical US examples (ASAE D497.5 FEB2006 Table 6). Cowpea K and all yields/prices are illustrative.",
      ],
      [
        "Fairness method",
        "Greedy feasible sequence; own and remaining deadlines checked; booking order retained if its estimated loss is lower.",
      ],
    ];
    downloadFile(
      "tractor_schedule_results.csv",
      "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
    toast("Results exported, including inputs and assumptions.");
  }
  // Event delegation keeps controls working after table updates.
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.dataset.view) {
      switchView(el.dataset.view);
      return;
    }
    if (el.hasAttribute("data-add")) {
      openFarm();
      return;
    }
    if (el.dataset.close) {
      $(el.dataset.close).close();
      return;
    }
    if (el.dataset.detail) {
      showDetail(el.dataset.detail);
      return;
    }
    if (el.dataset.edit) {
      openFarm(el.dataset.edit);
      return;
    }
    if (el.dataset.delete) {
      const id = el.dataset.delete,
        index = state.farms.findIndex((f) => f.id === id),
        removed = clone(state.farms[index]);
      state.farms = state.farms.filter((f) => f.id !== id);
      markChanged();
      toast(removed.name + " removed.", () => {
        if (!state.farms.some((f) => f.id === id) && state.farms.length < 200) {
          state.farms.splice(Math.min(index, state.farms.length), 0, removed);
          state.nextId = Math.max(state.nextId, Number(id.slice(1)) + 1);
          markChanged();
        }
      });
      return;
    }
    if (el.dataset.move) {
      const i = state.farms.findIndex((f) => f.id === el.dataset.move),
        j = i + Number(el.dataset.direction);
      if (j >= 0 && j < state.farms.length) {
        [state.farms[i], state.farms[j]] = [state.farms[j], state.farms[i]];
        markChanged();
      }
      return;
    }
  });
  $("addTop").addEventListener("click", () => openFarm());
  $("farmForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("farmName").value.trim(),
      area = Number($("farmArea").value);
    if (!name || !Number.isFinite(area) || area < 0.01 || area > 10000) {
      toast("Enter a farm name and an area between 0.01 and 10,000 ha.");
      return;
    }
    if (editId) {
      const f = state.farms.find((f) => f.id === editId);
      Object.assign(f, { name, area, crop: $("farmCrop").value });
    } else {
      if (state.farms.length >= 200) {
        toast("This demonstration supports up to 200 farms.");
        return;
      }
      state.farms.push({
        id: "F" + String(state.nextId++).padStart(2, "0"),
        name,
        area,
        crop: $("farmCrop").value,
      });
    }
    $("farmDialog").close();
    markChanged();
    toast(editId ? "Farm updated." : "Farm added to the booking queue.");
  });
  $("scheduleSearch").addEventListener("input", renderSchedule);
  document.querySelectorAll("input[name=mode]").forEach((el) =>
    el.addEventListener("change", () => {
      state.settings.mode = el.value;
      save();
      render();
    }),
  );
  for (const id of ["capacity", "hours", "travel", "cap"])
    $(id).addEventListener("change", (e) => {
      const input = e.target,
        value = Number(input.value),
        limits = {
          capacity: [0.01, 100],
          hours: [0.1, 24],
          travel: [0, 100],
          cap: [0, 1000],
        },
        [min, max] = limits[id];
      if (
        !input.value ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      ) {
        input.value = state.settings[id];
        toast(
          "Enter a value between " +
            min +
            " and " +
            max +
            ". Your previous value is kept.",
        );
        return;
      }
      state.settings[id] = value;
      markChanged();
    });
  $("cropBody").addEventListener("change", (e) => {
    const input = e.target;
    if (!input.dataset.crop) return;
    const c = input.dataset.crop,
      k = input.dataset.param,
      value = Number(input.value),
      max = k === "k" ? 100 : k === "y" ? 1000 : 1e9;
    if (!input.value || !Number.isFinite(value) || value < 0 || value > max) {
      input.value = cropInputValue(c, k);
      toast(
        "Enter a value from 0 to " +
          number(max) +
          ". Your previous value is kept.",
      );
      return;
    }
    state.crops[c][k] = k === "k" ? value / 100 : value;
    markChanged();
  });
  $("scenario").addEventListener("change", () => {
    const choice = $("scenario").value;
    $("scenario").value = state.scenario;
    confirmChange(
      "This replaces the current farms, crop assumptions and tractor settings. Save a file from Bookings to keep your edits.",
      () => {
        state = makeScenario(choice);
        $("scheduleSearch").value = "";
        save();
        render();
        toast(
          choice === "blank"
            ? "Empty queue ready."
            : "Example loaded with its original settings.",
        );
      },
    );
  });
  $("confirmOK").onclick = () => {
    const action = pendingConfirm;
    pendingConfirm = null;
    $("confirmDialog").close();
    action?.();
  };
  $("confirmCancel").onclick = () => {
    pendingConfirm = null;
    $("confirmDialog").close();
  };
  $("confirmDialog").addEventListener("cancel", () => (pendingConfirm = null));
  $("saveScenario").onclick = () => {
    downloadFile(
      "tractor_scenario.json",
      JSON.stringify(state, null, 2),
      "application/json",
    );
    toast("Scenario file saved. Open it here to restore these inputs.");
  };
  $("importScenario").onclick = () => $("importInput").click();
  $("importInput").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (f.size > 1e6)
        throw Error("Choose a scenario file smaller than 1 MB.");
      const imported = validateState(JSON.parse(await f.text()));
      confirmChange(
        "Open this scenario? It replaces the current farms, crop assumptions and settings.",
        () => {
          state = imported;
          $("scheduleSearch").value = "";
          save();
          render();
          toast("Scenario opened.");
        },
      );
    } catch (err) {
      toast(
        "Cannot open this file. " +
          (err instanceof SyntaxError
            ? "Choose a valid JSON scenario."
            : err.message),
      );
    }
  };
  $("exportCSV").onclick = exportCSV;
  $("printResults").onclick = () => {
    const previous = view,
      oldSearch = $("scheduleSearch").value;
    $("scheduleSearch").value = "";
    renderSchedule();
    switchView("overview");
    window.print();
    $("scheduleSearch").value = oldSearch;
    renderSchedule();
    switchView(previous);
  };
  save();
  render();
  switchView("overview");
})();
