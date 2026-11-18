/* Offline scheduling model. No browser storage, HTML elements or network calls.
 * Read dailyLossRate, jobHours and priorityScore first. schedule then totals the
 * consequences of an order. The sample data below are illustrative.
 */
globalThis.TractorModel = (() => {
  "use strict";
  const DEFAULT_CROPS = {
    Maize: { k: 0.01, y: 2, p: 450000 },
    Rice: { k: 0.01, y: 2.5, p: 700000 },
    Soybean: { k: 0.006, y: 1.2, p: 800000 },
    Cowpea: { k: 0.004, y: 0.9, p: 900000 },
  };
  const CROP_NAMES = Object.keys(DEFAULT_CROPS);
  const PITCH = [
    ["Soybean", 3.05],
    ["Cowpea", 2.22],
    ["Maize", 2.7],
    ["Maize", 1.42],
    ["Maize", 2.95],
    ["Rice", 0.5],
    ["Cowpea", 1.57],
    ["Rice", 0.65],
    ["Cowpea", 0.57],
    ["Maize", 3.05],
    ["Maize", 2.02],
    ["Cowpea", 0.54],
    ["Rice", 0.53],
    ["Rice", 1.21],
    ["Rice", 1.91],
    ["Soybean", 1.97],
    ["Rice", 0.69],
    ["Rice", 1.44],
    ["Maize", 1.98],
    ["Rice", 1.79],
    ["Cowpea", 2.58],
    ["Cowpea", 2.04],
    ["Cowpea", 1.41],
    ["Rice", 2.62],
    ["Rice", 0.63],
    ["Soybean", 1.87],
    ["Soybean", 2.44],
    ["Soybean", 2.11],
  ];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const tol = (a, b) => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  function makeScenario(name) {
    const entries =
      name === "blank"
        ? []
        : name === "simple"
          ? [
              ["Cowpea", 2.6],
              ["Maize", 1.4],
              ["Rice", 0.5],
              ["Soybean", 1.2],
            ]
          : PITCH;
    return {
      version: 2,
      scenario: name === "blank" ? "custom" : name,
      crops: clone(DEFAULT_CROPS),
      settings: { capacity: 0.8, hours: 8, travel: 0.6, cap: 3, mode: "smith" },
      farms: entries.map(([crop, area], i) => ({
        id: "F" + String(i + 1).padStart(2, "0"),
        name: "Farm " + String(i + 1).padStart(2, "0"),
        crop,
        area,
      })),
      nextId: entries.length + 1,
    };
  }
  /** Estimated crop value lost per day: (1/day) × ha × tonnes/ha × naira/tonne. */
  function dailyLossRate(areaHa, crop) {
    return crop.k * areaHa * crop.y * crop.p;
  }

  /** Total working hours for this job, including the fixed allowance for each visit. */
  function jobHours(areaHa, settings) {
    return areaHa / settings.capacity + settings.travel;
  }

  /** A ranking score, not a cash return per hour. Higher scores go first. */
  function priorityScore(job) {
    return job.w / job.p;
  }

  /** w is the loss rate in naira/day; p is the duration in working hours. */
  function jobsFor(state) {
    return state.farms.map((farm, index) => ({
      ...farm,
      booking: index + 1,
      w: dailyLossRate(farm.area, state.crops[farm.crop]),
      p: jobHours(farm.area, state.settings),
    }));
  }

  /** Cost of an entire order: sum of each farm's loss rate × its completion day. */
  function schedule(order, hoursPerDay) {
    let elapsedHours = 0,
      loss = 0;
    const rows = order.map((job, index) => {
      const start = elapsedHours / hoursPerDay;
      elapsedHours += job.p;
      const finish = elapsedHours / hoursPerDay;
      const farmLoss = job.w * finish;
      loss += farmLoss;
      return {
        ...job,
        rank: index + 1,
        start,
        finish,
        loss: farmLoss,
        priority: priorityScore(job),
      };
    });
    return { rows, loss, duration: elapsedHours / hoursPerDay };
  }

  /** Smith's rule: rank ready jobs by decreasing w/p; ties keep booking order. */
  function smithOrder(jobs) {
    return [...jobs].sort(
      (left, right) =>
        priorityScore(right) - priorityScore(left) ||
        left.booking - right.booking,
    );
  }
  /** Greedy feasible sequence: test BOTH the chosen job and the EDD remainder. */
  function cappedOrder(jobs, s) {
    const base = schedule(jobs, s.hours);
    const deadlines = new Map(
      base.rows.map((j) => [j.id, (j.finish + s.cap) * s.hours]),
    );
    function feasible(t, rest) {
      for (const j of [...rest].sort(
        (a, b) =>
          deadlines.get(a.id) - deadlines.get(b.id) || a.booking - b.booking,
      )) {
        t += j.p;
        if (t > deadlines.get(j.id) + tol(t, deadlines.get(j.id))) return false;
      }
      return true;
    }
    let remaining = smithOrder(jobs),
      time = 0,
      order = [];
    while (remaining.length) {
      const index = remaining.findIndex((j, i) => {
        const end = time + j.p;
        return (
          end <= deadlines.get(j.id) + tol(end, deadlines.get(j.id)) &&
          feasible(
            end,
            remaining.filter((_, k) => k !== i),
          )
        );
      });
      if (index < 0) return { order: jobs, fallback: true };
      const j = remaining.splice(index, 1)[0];
      order.push(j);
      time += j.p;
    }
    if (schedule(order, s.hours).loss > base.loss + tol(base.loss, 0))
      return { order: jobs, fallback: true };
    return { order, fallback: false };
  }
  /** Evaluate booking order, priority order and (when requested) a feasible capped order. */
  function compute(s) {
    const jobs = jobsFor(s),
      fcfs = schedule(jobs, s.settings.hours),
      smith = schedule(smithOrder(jobs), s.settings.hours);
    const capped =
      s.settings.mode === "cap" ? cappedOrder(jobs, s.settings) : null;
    const selected = capped ? schedule(capped.order, s.settings.hours) : smith;
    const baseById = new Map(fcfs.rows.map((j) => [j.id, j]));
    selected.rows.forEach((j) => {
      j.baseFinish = baseById.get(j.id).finish;
      j.shift = j.finish - j.baseFinish;
    });
    const saving = Math.max(0, fcfs.loss - selected.loss),
      percent = fcfs.loss > 0 ? (100 * saving) / fcfs.loss : 0;
    const maxShift = Math.max(0, ...selected.rows.map((j) => j.shift));
    return {
      fcfs,
      smith,
      selected,
      saving,
      percent,
      maxShift,
      fallback: capped?.fallback || false,
      totalArea: jobs.reduce((a, j) => a + j.area, 0),
      baseById,
    };
  }
  /** Validate every imported number, identifier and crop before it can affect calculations. */
  function validateState(x) {
    if (
      !x ||
      x.version !== 2 ||
      !Array.isArray(x.farms) ||
      x.farms.length > 200
    )
      throw Error(
        "Use a Tractor Sequencer scenario file with at most 200 farms.",
      );
    const ranges = {
      capacity: [0.01, 100],
      hours: [0.1, 24],
      travel: [0, 100],
      cap: [0, 1000],
    };
    const finiteRange = (v, min, max) =>
      typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
    for (const [k, [min, max]] of Object.entries(ranges))
      if (!finiteRange(x.settings?.[k], min, max))
        throw Error("Invalid tractor setting: " + k + ".");
    if (!["smith", "cap"].includes(x.settings.mode))
      throw Error("Invalid scheduling mode.");
    for (const c of CROP_NAMES) {
      const v = x.crops?.[c];
      if (
        !v ||
        !finiteRange(v.k, 0, 1) ||
        !finiteRange(v.y, 0, 1000) ||
        !finiteRange(v.p, 0, 1e9)
      )
        throw Error("Invalid crop parameters for " + c + ".");
    }
    const ids = new Set();
    for (const f of x.farms) {
      if (
        typeof f.id !== "string" ||
        !/^F[0-9]{2,9}$/.test(f.id) ||
        ids.has(f.id) ||
        !CROP_NAMES.includes(f.crop) ||
        !finiteRange(f.area, 0.01, 10000) ||
        typeof f.name !== "string" ||
        !f.name.trim() ||
        f.name.length > 60
      )
        throw Error("Invalid farm entry or duplicate farm ID.");
      ids.add(f.id);
    }
    const largest = Math.max(0, ...x.farms.map((f) => Number(f.id.slice(1))));
    if (largest >= 999999999) throw Error("Farm IDs are out of range.");
    return {
      version: 2,
      scenario: ["pitch", "simple", "custom"].includes(x.scenario)
        ? x.scenario
        : "custom",
      crops: Object.fromEntries(
        CROP_NAMES.map((c) => [
          c,
          { k: x.crops[c].k, y: x.crops[c].y, p: x.crops[c].p },
        ]),
      ),
      settings: Object.fromEntries(
        [...Object.keys(ranges), "mode"].map((k) => [k, x.settings[k]]),
      ),
      farms: x.farms.map((f) => ({
        id: f.id,
        name: f.name.trim(),
        crop: f.crop,
        area: f.area,
      })),
      nextId: largest + 1,
    };
  }

  return Object.freeze({
    CROP_NAMES,
    makeScenario,
    compute,
    validateState,
    dailyLossRate,
    jobHours,
    priorityScore,
  });
})();
