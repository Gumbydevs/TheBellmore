// simulate_balance.js
// Simulate many shifts to estimate average internal units consumed

const TIME_UNIT_MIN = 30;
const UNITS_PER_HOUR = 60 / TIME_UNIT_MIN; // 2
const SHIFT_HOURS = 8;
const SHIFT_UNITS = SHIFT_HOURS * UNITS_PER_HOUR; // 16

const ACTION_BASE_UNITS = {
  carry: Math.round(1 * UNITS_PER_HOUR),   // 1h -> 2
  checkin: Math.round(2 * UNITS_PER_HOUR), // 2h -> 4
  stopby: Math.round(2 * UNITS_PER_HOUR),  // 2h -> 4
  task: Math.round(2 * UNITS_PER_HOUR),    // 2h -> 4
  ghost: Math.round(2 * UNITS_PER_HOUR),   // 2h -> 4
  request: Math.round(3 * UNITS_PER_HOUR)  // 3h -> 6
};

const OVERHEAD_MAX_UNITS = 1; // up to 1 extra unit
const OVERHEAD_PROB = 0.5; // chance to incur overhead

const ACTIONS = Object.keys(ACTION_BASE_UNITS);
// base player tendencies (weights) for choosing actions
const WEIGHTS = {
  carry: 0.12,
  checkin: 0.18,
  stopby: 0.18,
  task: 0.22,
  ghost: 0.15,
  request: 0.15
};

function randOverhead() { return Math.random() < OVERHEAD_PROB ? OVERHEAD_MAX_UNITS : 0; }

function weightedChoice(choices, weights) {
  const total = choices.reduce((s,k)=>s+weights[k],0);
  let r = Math.random() * total;
  for (const k of choices) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return choices[choices.length-1];
}

function simulateOneShift() {
  let unitsLeft = SHIFT_UNITS;
  const counts = Object.fromEntries(ACTIONS.map(a=>[a,0]));
  let actionsTaken = 0;
  while (true) {
    // list affordable actions (conservative: base + max overhead)
    const affordable = ACTIONS.filter(a => unitsLeft >= (ACTION_BASE_UNITS[a] + OVERHEAD_MAX_UNITS));
    if (affordable.length === 0) break;
    // pick weighted among affordable
    const pick = weightedChoice(affordable, WEIGHTS);
    const overhead = randOverhead();
    const cost = ACTION_BASE_UNITS[pick] + overhead;
    if (cost > unitsLeft) {
      // rarely happens; re-evaluate affordable list
      continue;
    }
    unitsLeft -= cost;
    counts[pick]++;
    actionsTaken++;
  }
  return {unitsLeft, counts, actionsTaken};
}

function runSim(n) {
  let totalUnitsConsumed = 0;
  let totalActions = 0;
  const aggCounts = Object.fromEntries(ACTIONS.map(a=>[a,0]));
  let zeroLeft = 0;
  for (let i=0;i<n;i++) {
    const res = simulateOneShift();
    const consumed = SHIFT_UNITS - res.unitsLeft;
    totalUnitsConsumed += consumed;
    totalActions += res.actionsTaken;
    for (const a of ACTIONS) aggCounts[a] += res.counts[a];
    if (res.unitsLeft === 0) zeroLeft++;
  }
  console.log('Simulated', n, 'shifts');
  console.log('Average units consumed per shift:', (totalUnitsConsumed/n).toFixed(3));
  console.log('Average actions per shift:', (totalActions/n).toFixed(3));
  console.log('Percent shifts that exhausted time:', ((zeroLeft/n)*100).toFixed(2)+'%');
  console.log('Average per-action counts:');
  for (const a of ACTIONS) console.log('  ', a.padEnd(8), (aggCounts[a]/n).toFixed(4));
}

const N = parseInt(process.argv[2] || '100000',10);
runSim(N);
