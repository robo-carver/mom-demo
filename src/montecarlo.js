import { HISTORY } from './history.js';
import { project, isSustainable, maxSustainableSpend } from './model.js';

// Deterministic generator so the same settings always give the same answer.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each path is a list of history indices, one per year, drawn with replacement.
export function samplePaths({ runs, years, seed = 1 }) {
  const random = seededRandom(seed);
  return Array.from({ length: runs }, () =>
    Array.from({ length: years }, () => Math.floor(random() * HISTORY.length)));
}

export function ratesFromPath(path, base) {
  return (t) => {
    const [, stock, bond, home] = HISTORY[path[t]];
    return { stock, bond, condo: home, condoCostsExtra: base.condoCostsExtra };
  };
}

function percentile(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Monthly spend that holds up in `confidence` of the sampled histories, plus
// the spread of outcomes at that spend for the chart.
export function solveSpendMonteCarlo(inputs, scenario, assumptions) {
  const { runs, confidence } = assumptions.montecarlo;
  const base = assumptions.returns.expected;
  const paths = samplePaths({ runs, years: scenario.horizonYears });
  const rateFns = paths.map((p) => ratesFromPath(p, base));

  const spends = rateFns.map((ratesFor) =>
    maxSustainableSpend(inputs, scenario, assumptions, ratesFor, { iterations: 11, ceiling: 8000 }));
  const sorted = [...spends].sort((a, b) => a - b);
  const monthlySpend = percentile(sorted, 1 - confidence);
  const feasible = monthlySpend > 0;

  const runsAtSpend = rateFns.map((ratesFor) => project(inputs, scenario, assumptions, monthlySpend, ratesFor));
  const total = (r) => r.balances.liquid + r.balances.condoEquity;
  const band = Array.from({ length: scenario.horizonYears }, (_, t) => {
    const totals = runsAtSpend.map((rows) => total(rows[t])).sort((a, b) => a - b);
    return { low: percentile(totals, 0.1), mid: percentile(totals, 0.5), high: percentile(totals, 0.9) };
  });
  const heldUp = spends.filter((s) => s >= monthlySpend).length / runs;
  const ranOut = runsAtSpend.filter((rows) => rows.some((r) => r.shortfall > 0)).length / runs;
  const medianIndex = spends.indexOf(sorted[Math.floor(sorted.length / 2)]);
  const rows = runsAtSpend[medianIndex];
  const failYears = runsAtSpend.map((r) => r.findIndex((row) => row.shortfall > 0)).filter((y) => y >= 0);

  return {
    monthlySpend, feasible, rows, band, heldUp, ranOut, runs,
    failYear: feasible ? null : (failYears.length ? Math.round(percentile(failYears.sort((a, b) => a - b), 0.5)) : null),
    ruinedAtZero: spends.filter((s) => s === 0).length / runs,
  };
}

export function isMonteCarlo(scenario) {
  return scenario.returns === 'montecarlo';
}

export { isSustainable };
