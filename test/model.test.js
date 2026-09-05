import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { project, solveSpend, isSustainable, requiredMinimumDistribution } from '../src/model.js';
import { DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS } from '../src/defaults.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const withInputs = (patch) => ({ ...clone(DEMO_INPUTS), ...patch });
const withScenario = (patch) => ({ ...clone(DEMO_SCENARIO), ...patch });

const noCondo = () => withInputs({
  condo: { ...clone(DEMO_INPUTS.condo), value: 0, mortgageBalance: 0, rentIncomeMonthly: 0, hoaMonthly: 0,
    propertyTaxAnnual: 0, insuranceAnnual: 0, maintenanceAnnual: 0, specialAssessments: [] },
  socialSecurityMonthly: 0, employment: { monthly: 0 }, selfEmployment: { monthly: 0 },
  rentPaidMonthly: 0, savingsBalance: 0, medical: { premiumMonthly: 0 }, oneTimeExpenses: [],
});

const noNaN = (rows) => {
  const walk = (v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), 'non-finite value in rows');
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(rows);
};

test('an untouched retirement account compounds at the bond return', () => {
  const inputs = noCondo();
  const scenario = withScenario({ condoPlan: 'sell', condoYear: 0, retirementStockPct: 0, horizonYears: 5 });
  const assumptions = { ...clone(DEMO_ASSUMPTIONS), irmaa: false };
  const rows = project(inputs, scenario, assumptions, 0);
  const expected = inputs.retirementBalance * 1.015 ** 4;
  assert.ok(Math.abs(rows[4].balances.retirement - expected) < 1);
  noNaN(rows);
});

test('required distributions start at 73 and follow the table', () => {
  assert.equal(requiredMinimumDistribution(100000, 72), 0);
  assert.ok(Math.abs(requiredMinimumDistribution(265000, 73) - 10000) < 1e-6);
  const rows = project(DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS, 0);
  const at73 = rows.find((r) => r.age === 73);
  assert.ok(at73.withdrawals.fromRetirement >= at73.withdrawals.rmd - 1e-6);
  assert.ok(at73.withdrawals.rmd > 0);
});

test('selling the condo moves equity into the brokerage account', () => {
  const scenario = withScenario({ condoPlan: 'sell', condoYear: 2 });
  const rows = project(DEMO_INPUTS, scenario, DEMO_ASSUMPTIONS, 2000);
  assert.ok(rows[1].balances.condoEquity > 0);
  assert.ok(rows[2].income.saleProceeds > 0);
  assert.equal(rows[3].balances.condoEquity, 0);
  assert.equal(rows[3].income.rentIncome, 0);
  assert.ok(rows[2].balances.brokerage > rows[1].balances.brokerage);
  assert.ok(rows[2].taxes.state > 0, 'Illinois taxes the gain');
});

test('moving in ends both the rent paid and the rent collected', () => {
  const scenario = withScenario({ condoPlan: 'movein', condoYear: 4 });
  const rows = project(DEMO_INPUTS, scenario, DEMO_ASSUMPTIONS, 2000);
  assert.ok(rows[3].expenses.rentPaid > 0);
  assert.equal(rows[4].expenses.rentPaid, 0);
  assert.equal(rows[4].income.rentIncome, 0);
  assert.ok(rows[4].expenses.ownerCosts > 0);
  assert.ok(rows[4].balances.condoEquity > 0);
});

test('long-term care lands in the final years only', () => {
  const scenario = withScenario({ longTermCare: true, horizonYears: 20 });
  const rows = project(DEMO_INPUTS, scenario, DEMO_ASSUMPTIONS, 2000);
  assert.equal(rows[16].expenses.longTermCare, 0);
  assert.equal(rows[17].expenses.longTermCare, DEMO_INPUTS.longTermCare.monthly * 12);
});

test('spending far beyond the assets is reported as a shortfall', () => {
  assert.equal(isSustainable(DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS, 50000), false);
  const rows = project(DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS, 50000);
  assert.ok(rows.some((r) => r.shortfall > 0));
  noNaN(rows);
});

test('solved spend is sustainable and a little more is not', () => {
  const { monthlySpend, feasible } = solveSpend(DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS);
  assert.ok(feasible);
  assert.ok(monthlySpend > 500);
  assert.ok(isSustainable(DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS, monthlySpend));
  assert.equal(isSustainable(DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS, monthlySpend + 50), false);
});

test('better markets, more savings and a shorter horizon all raise the spend', () => {
  const spend = (i, s) => solveSpend(i, s, DEMO_ASSUMPTIONS).monthlySpend;
  const base = spend(DEMO_INPUTS, DEMO_SCENARIO);
  assert.ok(spend(DEMO_INPUTS, withScenario({ returns: 'pessimistic' })) < base);
  assert.ok(spend(DEMO_INPUTS, withScenario({ returns: 'optimistic' })) > base);
  assert.ok(spend(withInputs({ retirementBalance: DEMO_INPUTS.retirementBalance + 100000 }), DEMO_SCENARIO) > base);
  assert.ok(spend(DEMO_INPUTS, withScenario({ horizonYears: 20 })) > base);
  assert.ok(spend(DEMO_INPUTS, withScenario({ longTermCare: true })) < base);
});

test('the solver reports the year money runs out when nothing is sustainable', () => {
  const inputs = withInputs({ retirementBalance: 0, savingsBalance: 0, socialSecurityMonthly: 0, rentPaidMonthly: 4000 });
  const result = solveSpend(inputs, withScenario({ condoPlan: 'sell', condoYear: 0 }), DEMO_ASSUMPTIONS);
  assert.equal(result.feasible, false);
  assert.ok(Number.isInteger(result.failYear));
});

const arbInputs = fc.record({
  retirementBalance: fc.integer({ min: 0, max: 2000000 }),
  savingsBalance: fc.integer({ min: 0, max: 500000 }),
  socialSecurityMonthly: fc.integer({ min: 0, max: 5000 }),
  rentPaidMonthly: fc.integer({ min: 0, max: 5000 }),
  condoValue: fc.integer({ min: 0, max: 1500000 }),
  mortgageBalance: fc.integer({ min: 0, max: 400000 }),
  rentIncomeMonthly: fc.integer({ min: 0, max: 6000 }),
  costBasis: fc.integer({ min: 0, max: 800000 }),
}).map((r) => withInputs({
  retirementBalance: r.retirementBalance, savingsBalance: r.savingsBalance,
  socialSecurityMonthly: r.socialSecurityMonthly, rentPaidMonthly: r.rentPaidMonthly,
  condo: { ...clone(DEMO_INPUTS.condo), value: r.condoValue, mortgageBalance: r.mortgageBalance,
    rentIncomeMonthly: r.rentIncomeMonthly, costBasis: r.costBasis },
}));

const arbScenario = fc.record({
  returns: fc.constantFrom('pessimistic', 'expected', 'optimistic'),
  condoPlan: fc.constantFrom('keep', 'sell', 'movein'),
  condoYear: fc.integer({ min: 0, max: 20 }),
  proceedsStockPct: fc.integer({ min: 0, max: 100 }),
  retirementStockPct: fc.integer({ min: 0, max: 100 }),
  employmentEndYear: fc.integer({ min: 0, max: 15 }),
  selfEmploymentEndYear: fc.integer({ min: 0, max: 15 }),
  horizonYears: fc.integer({ min: 20, max: 35 }),
  longTermCare: fc.boolean(),
  cushionYears: fc.integer({ min: 0, max: 5 }),
});

test('for any inputs the solver is consistent and the projection is finite', () => {
  fc.assert(fc.property(arbInputs, arbScenario, (inputs, scenario) => {
    const result = solveSpend(inputs, scenario, DEMO_ASSUMPTIONS);
    noNaN(result.rows);
    assert.equal(result.rows.length, scenario.horizonYears);
    if (result.feasible) {
      assert.ok(isSustainable(inputs, scenario, DEMO_ASSUMPTIONS, result.monthlySpend));
      assert.equal(isSustainable(inputs, scenario, DEMO_ASSUMPTIONS, result.monthlySpend + 100), false);
    } else {
      assert.equal(result.monthlySpend, 0);
    }
    for (const row of result.rows) {
      assert.ok(row.balances.retirement >= -1e-6);
      assert.ok(row.balances.brokerage >= 0);
      assert.ok(row.taxes.federal >= 0 && row.taxes.state >= 0);
    }
  }), { numRuns: 150 });
});

test('sale tax estimate separates recapture from gain and values the exclusion', async () => {
  const { saleTaxEstimate } = await import('../src/model.js');
  const est = saleTaxEstimate(DEMO_INPUTS, DEMO_SCENARIO);
  assert.ok(est.gain > 0);
  assert.ok(est.recapturedDepreciation > 0 && est.recapturedDepreciation < est.gain);
  assert.ok(est.federal > 0 && est.state > 0);
  assert.ok(est.exclusionSavings > 0 && est.exclusionSavings <= est.federal);
});
