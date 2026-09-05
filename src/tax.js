// Federal and state tax rules for a single filer, 2026 figures.
// All amounts are in today's dollars. Thresholds that Congress indexes to
// inflation stay constant in real terms; thresholds fixed in nominal law are
// deflated by the caller (see `deflate`).

export const FEDERAL_BRACKETS = [
  { upTo: 12400, rate: 0.10 },
  { upTo: 50400, rate: 0.12 },
  { upTo: 105700, rate: 0.22 },
  { upTo: 201775, rate: 0.24 },
  { upTo: 256225, rate: 0.32 },
  { upTo: 640600, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

export const STANDARD_DEDUCTION = 16100;
export const SENIOR_EXTRA_DEDUCTION = 2050;
export const LOW_BRACKET_TOP = 50400;

export const CAPITAL_GAINS_TIERS = [
  { upTo: 49450, rate: 0 },
  { upTo: 545500, rate: 0.15 },
  { upTo: Infinity, rate: 0.20 },
];
export const DEPRECIATION_RECAPTURE_RATE = 0.25;

export const NIIT_RATE = 0.038;
export const NIIT_THRESHOLD_NOMINAL = 200000;

export const SS_THRESHOLDS_NOMINAL = { lower: 25000, upper: 34000 };

export const SELF_EMPLOYMENT_TAX_RATE = 0.153;
export const SELF_EMPLOYMENT_TAXABLE_SHARE = 0.9235;

export const ILLINOIS_RATE = 0.0495;

// Monthly Medicare surcharge (Part B plus Part D) by income tier, 2026.
export const IRMAA_TIERS = [
  { upTo: 109000, monthly: 0 },
  { upTo: 137000, monthly: 97 },
  { upTo: 171000, monthly: 243 },
  { upTo: 205000, monthly: 388 },
  { upTo: 500000, monthly: 534 },
  { upTo: Infinity, monthly: 590 },
];

export function deflate(nominal, inflation, yearsFromNow) {
  return nominal / (1 + inflation) ** yearsFromNow;
}

function taxThroughTiers(amount, tiers, startAt = 0) {
  let tax = 0;
  let floor = 0;
  for (const { upTo, rate } of tiers) {
    const lo = Math.max(floor, startAt);
    const hi = Math.min(upTo, startAt + amount);
    if (hi > lo) tax += (hi - lo) * rate;
    floor = upTo;
  }
  return tax;
}

export function ordinaryIncomeTax(taxableIncome) {
  return taxThroughTiers(Math.max(0, taxableIncome), FEDERAL_BRACKETS);
}

// Long-term gains stack on top of ordinary taxable income.
export function capitalGainsTax(gain, ordinaryTaxableIncome) {
  return taxThroughTiers(Math.max(0, gain), CAPITAL_GAINS_TIERS, Math.max(0, ordinaryTaxableIncome));
}

// Share of Social Security benefit that counts as taxable income.
export function taxableSocialSecurity(benefit, otherIncome, thresholds = SS_THRESHOLDS_NOMINAL) {
  const provisional = otherIncome + benefit / 2;
  if (provisional <= thresholds.lower) return 0;
  if (provisional <= thresholds.upper) {
    return Math.min(benefit / 2, (provisional - thresholds.lower) / 2);
  }
  const middleBand = Math.min(benefit / 2, (thresholds.upper - thresholds.lower) / 2);
  return Math.min(0.85 * benefit, 0.85 * (provisional - thresholds.upper) + middleBand);
}

export function selfEmploymentTax(netEarnings) {
  return Math.max(0, netEarnings) * SELF_EMPLOYMENT_TAXABLE_SHARE * SELF_EMPLOYMENT_TAX_RATE;
}

export function standardDeduction({ age }) {
  return STANDARD_DEDUCTION + (age >= 65 ? SENIOR_EXTRA_DEDUCTION : 0);
}

export function irmaaMonthlySurcharge(magiTwoYearsAgo) {
  return IRMAA_TIERS.find((tier) => magiTwoYearsAgo <= tier.upTo).monthly;
}

// Federal tax for one year. `ordinary` excludes Social Security; the taxable
// share of the benefit is computed here.
export function federalTax({
  age,
  wages = 0,
  selfEmployment = 0,
  rentalProfit = 0,
  retirementWithdrawals = 0,
  socialSecurity = 0,
  capitalGains = 0,
  recapturedDepreciation = 0,
  inflation = 0,
  yearsFromNow = 0,
}) {
  const seTax = selfEmploymentTax(selfEmployment);
  const otherIncome =
    wages + selfEmployment - seTax / 2 + rentalProfit + retirementWithdrawals +
    capitalGains + recapturedDepreciation;
  const ssThresholds = {
    lower: deflate(SS_THRESHOLDS_NOMINAL.lower, inflation, yearsFromNow),
    upper: deflate(SS_THRESHOLDS_NOMINAL.upper, inflation, yearsFromNow),
  };
  const taxableSS = taxableSocialSecurity(socialSecurity, otherIncome, ssThresholds);
  const agi = otherIncome + taxableSS;
  const taxable = Math.max(0, agi - standardDeduction({ age }));

  const preferential = Math.min(taxable, capitalGains + recapturedDepreciation);
  const ordinaryTaxable = taxable - preferential;
  const recaptureShare = Math.min(preferential, recapturedDepreciation);
  const gainShare = preferential - recaptureShare;

  const recaptureTax = Math.min(
    ordinaryIncomeTax(ordinaryTaxable + recaptureShare) - ordinaryIncomeTax(ordinaryTaxable),
    recaptureShare * DEPRECIATION_RECAPTURE_RATE,
  );
  const gainsTax = capitalGainsTax(gainShare, ordinaryTaxable + recaptureShare);
  const niitThreshold = deflate(NIIT_THRESHOLD_NOMINAL, inflation, yearsFromNow);
  const investmentIncome = capitalGains + recapturedDepreciation + Math.max(0, rentalProfit);
  const niit = NIIT_RATE * Math.max(0, Math.min(investmentIncome, agi - niitThreshold));

  return {
    tax: ordinaryIncomeTax(ordinaryTaxable) + recaptureTax + gainsTax + niit + seTax,
    agi,
    taxableIncome: taxable,
  };
}

// Illinois taxes a non-resident on Illinois-source income (the rental and any
// gain on selling it) and taxes a resident on everything except retirement
// income, which the state exempts.
export function illinoisTax({ resident, wages = 0, selfEmployment = 0, rentalProfit = 0, condoGain = 0 }) {
  const base = resident
    ? wages + selfEmployment + Math.max(0, rentalProfit) + Math.max(0, condoGain)
    : Math.max(0, rentalProfit) + Math.max(0, condoGain);
  return base * ILLINOIS_RATE;
}
