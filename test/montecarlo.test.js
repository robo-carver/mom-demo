import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samplePaths, ratesFromPath, solveSpendMonteCarlo, seededRandom } from '../src/montecarlo.js';
import { solveSpend, isSustainable } from '../src/model.js';
import { HISTORY } from '../src/history.js';
import { DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS } from '../src/defaults.js';

const mc = { ...DEMO_SCENARIO, returns: 'montecarlo' };

test('history covers 1928 to 2025 with plausible real returns', () => {
  assert.equal(HISTORY[0][0], 1928);
  assert.equal(HISTORY[HISTORY.length - 1][0], 2025);
  const stock = HISTORY.map((h) => h[1]);
  const geo = stock.reduce((p, r) => p * (1 + r), 1) ** (1 / stock.length) - 1;
  assert.ok(geo > 0.05 && geo < 0.08, `stock geometric real return ${geo}`);
  assert.ok(Math.min(...stock) < -0.3, 'includes a crash year');
});

test('seeded sampling is reproducible and draws whole history years', () => {
  const a = samplePaths({ runs: 3, years: 5, seed: 7 });
  const b = samplePaths({ runs: 3, years: 5, seed: 7 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, samplePaths({ runs: 3, years: 5, seed: 8 }));
  const r = seededRandom(1);
  for (let i = 0; i < 1000; i += 1) { const v = r(); assert.ok(v >= 0 && v < 1); }
  const rates = ratesFromPath([0, 1], DEMO_ASSUMPTIONS.returns.expected);
  assert.equal(rates(0).stock, HISTORY[0][1]);
  assert.equal(rates(1).bond, HISTORY[1][2]);
});

test('the 90 percent spend is below the fixed expected case and holds up in at least 90 percent of runs', () => {
  const result = solveSpendMonteCarlo(DEMO_INPUTS, mc, DEMO_ASSUMPTIONS);
  const expected = solveSpend(DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS);
  assert.ok(result.feasible);
  assert.ok(result.monthlySpend < expected.monthlySpend);
  assert.ok(result.heldUp >= 0.9 && result.heldUp < 0.95, `held up ${result.heldUp}`);
  assert.ok(result.ranOut <= 1 - result.heldUp);
  assert.equal(result.band.length, mc.horizonYears);
  for (const { low, mid, high } of result.band) assert.ok(low <= mid && mid <= high);
  assert.ok(result.rows.every((r) => Number.isFinite(r.balances.liquid)));
});

test('a stock-heavy 401k widens the band', () => {
  const bonds = solveSpendMonteCarlo(DEMO_INPUTS, mc, DEMO_ASSUMPTIONS);
  const stocks = solveSpendMonteCarlo(DEMO_INPUTS, { ...mc, retirementStockPct: 100 }, DEMO_ASSUMPTIONS);
  const width = (r) => r.band[10].high - r.band[10].low;
  assert.ok(width(stocks) > width(bonds));
});

test('hopeless inputs report ruin instead of a spend', () => {
  const inputs = { ...DEMO_INPUTS, retirementBalance: 0, savingsBalance: 0, socialSecurityMonthly: 0, rentPaidMonthly: 4000 };
  const result = solveSpendMonteCarlo(inputs, { ...mc, condoPlan: 'sell', condoYear: 0 }, DEMO_ASSUMPTIONS);
  assert.equal(result.feasible, false);
  assert.equal(result.monthlySpend, 0);
  assert.ok(Number.isInteger(result.failYear));
  assert.ok(!isSustainable(inputs, { ...DEMO_SCENARIO, condoPlan: 'sell', condoYear: 0 }, DEMO_ASSUMPTIONS, 0));
});
