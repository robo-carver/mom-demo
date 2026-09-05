import { federalTax, illinoisTax, irmaaMonthlySurcharge, LOW_BRACKET_TOP, standardDeduction } from './tax.js';
import { CURRENT_YEAR } from './defaults.js';

const RMD_START_AGE = 73;
const RMD_DIVISORS = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
  81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7,
  89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4,
  97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
};
const DEPRECIATION_YEARS = 27.5;

export function requiredMinimumDistribution(balance, age) {
  if (age < RMD_START_AGE) return 0;
  return balance / RMD_DIVISORS[Math.min(age, 100)];
}

function realRate(nominal, inflation) {
  return (1 + nominal) / (1 + inflation) - 1;
}

function blendedReturn(stockPct, rates) {
  const share = stockPct / 100;
  return share * rates.stock + (1 - share) * rates.bond;
}

// Fixed nominal mortgage payment, expressed in today's dollars for year t.
function mortgagePayment({ mortgageBalance, mortgageRate, mortgageYearsLeft }) {
  if (mortgageBalance <= 0 || mortgageYearsLeft <= 0) return 0;
  if (mortgageRate === 0) return mortgageBalance / mortgageYearsLeft;
  const r = mortgageRate;
  const n = mortgageYearsLeft;
  return (mortgageBalance * r) / (1 - (1 + r) ** -n);
}

function sumAt(entries, year) {
  return entries.filter((e) => e.year === year).reduce((s, e) => s + e.amount, 0);
}

function condoPhase(scenario, t) {
  if (scenario.condoPlan === 'keep') return 'rented';
  if (t < scenario.condoYear) return 'rented';
  if (t === scenario.condoYear && scenario.condoPlan === 'sell') return 'selling';
  return scenario.condoPlan === 'sell' ? 'sold' : 'home';
}

// Withdrawal split for a gross amount `total`: required distributions first,
// then the retirement account up to the top of the 12% bracket, then the
// brokerage account, then the retirement account for the rest.
function splitWithdrawal(total, { retirement, brokerage, rmd, lowBracketRoom }) {
  const bracketFill = Math.min(retirement, Math.max(rmd, lowBracketRoom));
  let fromRetirement = Math.min(total, bracketFill);
  const fromBrokerage = Math.min(total - fromRetirement, brokerage);
  fromRetirement += Math.min(total - fromRetirement - fromBrokerage, retirement - fromRetirement);
  return { fromRetirement, fromBrokerage };
}

function solveMonotone(f, lo, hi, target, iterations = 30) {
  for (let i = 0; i < iterations; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid; else hi = mid;
  }
  return hi;
}

export function fixedRates(scenario, assumptions) {
  const rates = assumptions.returns[scenario.returns];
  return () => rates;
}

// `ratesFor(t)` supplies the year's returns; the default repeats the
// scenario's fixed rates every year.
export function project(inputs, scenario, assumptions, monthlySpend, ratesFor = fixedRates(scenario, assumptions)) {
  const { inflation } = assumptions;
  const condo = inputs.condo;
  const rentPaidGrowth = realRate(inputs.rentPaidIncrease, inflation);
  const nominalMortgagePayment = mortgagePayment(condo);
  const buildingBasis = condo.costBasis * (1 - condo.landShare);
  const annualDepreciation = buildingBasis / DEPRECIATION_YEARS;

  let retirement = inputs.retirementBalance;
  let brokerage = inputs.savingsBalance;
  let brokerageBasis = inputs.savingsBalance;
  let mortgageNominal = condo.mortgageBalance;
  let condoValue = condo.value;
  let depreciationTaken = Math.min(buildingBasis, annualDepreciation * (CURRENT_YEAR - condo.rentedSinceYear));
  const magiHistory = [];
  const rows = [];

  for (let t = 0; t < scenario.horizonYears; t += 1) {
    const rates = ratesFor(t);
    const age = inputs.age + t;
    const phase = condoPhase(scenario, t);
    const deflator = (1 + inflation) ** t;
    const costGrowth = (1 + rates.condoCostsExtra) ** t;

    const wages = t < scenario.employmentEndYear ? inputs.employment.monthly * 12 : 0;
    const selfEmployment = t < scenario.selfEmploymentEndYear ? inputs.selfEmployment.monthly * 12 : 0;
    const socialSecurity = inputs.socialSecurityMonthly * 12;

    const ownsCondo = phase !== 'sold';
    const payingMortgage = mortgageNominal > 0 && ownsCondo && phase !== 'selling';
    const mortgagePaymentReal = payingMortgage ? nominalMortgagePayment / deflator : 0;
    const mortgageInterestReal = payingMortgage ? (mortgageNominal * condo.mortgageRate) / deflator : 0;
    const ownerCosts = ownsCondo
      ? (condo.hoaMonthly * 12 + condo.propertyTaxAnnual + condo.insuranceAnnual + condo.maintenanceAnnual) * costGrowth +
        sumAt(condo.specialAssessments, t)
      : 0;
    const rentIncome = phase === 'rented' || phase === 'selling'
      ? condo.rentIncomeMonthly * 12 * (1 - condo.vacancyRate) * costGrowth
      : 0;
    const depreciationThisYear = rentIncome > 0
      ? Math.min(annualDepreciation, buildingBasis - depreciationTaken)
      : 0;
    const rentalProfit = rentIncome > 0
      ? rentIncome - ownerCosts - mortgageInterestReal - depreciationThisYear
      : 0;
    const condoCashFlow = rentIncome - ownerCosts - mortgagePaymentReal;

    let saleProceeds = 0;
    let capitalGains = 0;
    let recapturedDepreciation = 0;
    let condoGain = 0;
    if (phase === 'selling') {
      const net = condoValue * (1 - condo.sellingCostRate);
      saleProceeds = net - mortgageNominal / deflator;
      condoGain = Math.max(0, net - (condo.costBasis - depreciationTaken - depreciationThisYear));
      recapturedDepreciation = Math.min(condoGain, depreciationTaken + depreciationThisYear);
      capitalGains = condoGain - recapturedDepreciation;
    }

    const rentPaid = phase === 'home' ? 0 : inputs.rentPaidMonthly * 12 * (1 + rentPaidGrowth) ** t;
    const magiLookback = magiHistory[t - 2] ?? magiHistory[0] ?? 0;
    const medical = inputs.medical.premiumMonthly * 12 * (1 + assumptions.medicalInflationExtra) ** t +
      (assumptions.irmaa ? irmaaMonthlySurcharge(magiLookback) * 12 : 0);
    const careYears = scenario.longTermCare ? inputs.longTermCare.years : 0;
    const longTermCare = t >= scenario.horizonYears - careYears ? inputs.longTermCare.monthly * 12 : 0;
    const oneTime = sumAt(inputs.oneTimeExpenses, t);
    const spending = monthlySpend * 12 + rentPaid + medical + longTermCare + oneTime;

    const rmd = requiredMinimumDistribution(retirement, age);
    const resident = phase === 'home';

    const taxesFor = (fromRetirement, fromBrokerage) => {
      const brokerageGain = brokerage > 0 ? fromBrokerage * (1 - brokerageBasis / brokerage) : 0;
      const federal = federalTax({
        age, wages, selfEmployment, rentalProfit, socialSecurity,
        retirementWithdrawals: fromRetirement,
        capitalGains: capitalGains + brokerageGain,
        recapturedDepreciation,
        inflation, yearsFromNow: t,
      });
      const state = illinoisTax({ resident, wages, selfEmployment, rentalProfit, condoGain });
      return { total: federal.tax + state, federal, state, brokerageGain };
    };

    const baseOrdinary = wages + selfEmployment + Math.max(0, rentalProfit) + socialSecurity * 0.85;
    const lowBracketRoom = Math.max(0, LOW_BRACKET_TOP + standardDeduction({ age }) - baseOrdinary);
    const pots = { retirement, brokerage, rmd, lowBracketRoom };
    const income = wages + selfEmployment + socialSecurity + condoCashFlow + saleProceeds;

    const netCash = (total) => {
      const { fromRetirement, fromBrokerage } = splitWithdrawal(total, pots);
      return income + fromRetirement + fromBrokerage - taxesFor(fromRetirement, fromBrokerage).total;
    };
    const available = retirement + brokerage;
    let withdrawal = Math.min(available, Math.max(rmd, 0));
    if (netCash(withdrawal) < spending) {
      withdrawal = netCash(available) < spending ? available : solveMonotone(netCash, withdrawal, available, spending);
    }
    const { fromRetirement, fromBrokerage } = splitWithdrawal(withdrawal, pots);
    const taxes = taxesFor(fromRetirement, fromBrokerage);
    const surplus = income + fromRetirement + fromBrokerage - taxes.total - spending;

    retirement -= fromRetirement;
    brokerageBasis -= brokerage > 0 ? fromBrokerage * (brokerageBasis / brokerage) : 0;
    brokerage -= fromBrokerage;
    brokerage += surplus;
    brokerageBasis += surplus;
    if (surplus < 0) brokerageBasis = Math.max(0, Math.min(brokerageBasis, brokerage));
    magiHistory.push(taxes.federal.agi);

    const shortfall = Math.max(0, -brokerage);
    depreciationTaken += depreciationThisYear;
    if (payingMortgage) {
      mortgageNominal = Math.max(0, mortgageNominal * (1 + condo.mortgageRate) - nominalMortgagePayment);
    }
    if (phase === 'selling') mortgageNominal = 0;

    const condoEquity = ownsCondo && phase !== 'selling' ? condoValue - mortgageNominal / deflator : 0;
    rows.push({
      year: t, age, phase,
      income: { wages, selfEmployment, socialSecurity, rentIncome, saleProceeds },
      expenses: { spending: monthlySpend * 12, rentPaid, medical, longTermCare, oneTime, ownerCosts, mortgage: mortgagePaymentReal },
      taxes: { federal: taxes.federal.tax, state: taxes.state, agi: taxes.federal.agi },
      withdrawals: { fromRetirement, fromBrokerage, rmd },
      balances: { retirement, brokerage: Math.max(0, brokerage), condoEquity, liquid: retirement + Math.max(0, brokerage) },
      shortfall,
    });
    if (shortfall > 0) {
      brokerage = 0;
      brokerageBasis = 0;
    }

    retirement *= 1 + blendedReturn(scenario.retirementStockPct, rates);
    brokerage *= 1 + blendedReturn(scenario.proceedsStockPct, rates);
    condoValue *= 1 + rates.condo;
  }

  return rows;
}

function cushionFor(inputs, scenario, monthlySpend, lastRow) {
  return scenario.cushionYears * (monthlySpend * 12 + lastRow.expenses.rentPaid + lastRow.expenses.medical);
}

export function isSustainable(inputs, scenario, assumptions, monthlySpend, ratesFor) {
  const rows = project(inputs, scenario, assumptions, monthlySpend, ratesFor);
  const last = rows[rows.length - 1];
  const neverShort = rows.every((r) => r.shortfall === 0);
  return neverShort && last.balances.liquid >= cushionFor(inputs, scenario, monthlySpend, last);
}

// Highest constant monthly spend (after rent and medical) that never runs
// short and ends the horizon with the cushion intact. Returns 0 when even
// that is out of reach.
export function maxSustainableSpend(inputs, scenario, assumptions, ratesFor, { iterations = 40, ceiling = 1000 } = {}) {
  const feasible = (spend) => isSustainable(inputs, scenario, assumptions, spend, ratesFor);
  if (!feasible(0)) return 0;
  let lo = 0;
  let hi = ceiling;
  while (feasible(hi) && hi < 1e7) hi *= 2;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (lo + hi) / 2;
    if (feasible(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

export function solveSpend(inputs, scenario, assumptions) {
  const monthlySpend = maxSustainableSpend(inputs, scenario, assumptions);
  const rows = project(inputs, scenario, assumptions, monthlySpend);
  if (monthlySpend === 0 && !isSustainable(inputs, scenario, assumptions, 0)) {
    const failYear = rows.findIndex((r) => r.shortfall > 0);
    return { monthlySpend: 0, feasible: false, failYear: failYear === -1 ? null : failYear, rows };
  }
  return { monthlySpend, feasible: true, failYear: null, rows };
}

// What selling today would cost in tax, and what the primary-residence
// exclusion would save if she lived there two years first.
export function saleTaxEstimate(inputs, scenario) {
  const condo = inputs.condo;
  const buildingBasis = condo.costBasis * (1 - condo.landShare);
  const depreciationTaken = Math.min(buildingBasis, (buildingBasis / DEPRECIATION_YEARS) * (CURRENT_YEAR - condo.rentedSinceYear));
  const net = condo.value * (1 - condo.sellingCostRate);
  const gain = Math.max(0, net - (condo.costBasis - depreciationTaken));
  const recapturedDepreciation = Math.min(gain, depreciationTaken);
  const capitalGains = gain - recapturedDepreciation;
  const baseline = {
    age: inputs.age,
    wages: inputs.employment.monthly * 12 * (scenario.employmentEndYear > 0 ? 1 : 0),
    selfEmployment: inputs.selfEmployment.monthly * 12 * (scenario.selfEmploymentEndYear > 0 ? 1 : 0),
    socialSecurity: inputs.socialSecurityMonthly * 12,
  };
  const without = federalTax(baseline).tax;
  const withSale = federalTax({ ...baseline, capitalGains, recapturedDepreciation }).tax;
  const withExclusion = federalTax({ ...baseline, capitalGains: Math.max(0, capitalGains - 250000), recapturedDepreciation }).tax;
  const state = illinoisTax({ resident: false, condoGain: gain });
  return {
    gain,
    recapturedDepreciation,
    federal: withSale - without,
    state,
    exclusionSavings: withSale - withExclusion,
  };
}
