// Demo numbers. Real figures are entered on the phone and stay in its storage.

export const DEMO_INPUTS = {
  age: 65,
  socialSecurityMonthly: 2100,
  employment: { monthly: 1800 },
  selfEmployment: { monthly: 1200 },
  rentPaidMonthly: 1900,
  rentPaidIncrease: 0.05,
  retirementBalance: 420000,
  savingsBalance: 30000,
  condo: {
    value: 320000,
    mortgageBalance: 90000,
    mortgageRate: 0.045,
    mortgageYearsLeft: 12,
    rentIncomeMonthly: 2300,
    hoaMonthly: 450,
    propertyTaxAnnual: 5200,
    insuranceAnnual: 900,
    maintenanceAnnual: 1800,
    vacancyRate: 0.08,
    costBasis: 210000,
    rentedSinceYear: 2006,
    landShare: 0.2,
    sellingCostRate: 0.07,
    specialAssessments: [{ year: 3, amount: 12000 }],
  },
  medical: { premiumMonthly: 380 },
  oneTimeExpenses: [{ year: 6, amount: 25000, label: 'Car' }],
  longTermCare: { years: 3, monthly: 6000 },
};

export const DEMO_SCENARIO = {
  returns: 'expected',
  condoPlan: 'keep',
  condoYear: 0,
  proceedsStockPct: 60,
  retirementStockPct: 0,
  employmentEndYear: 3,
  selfEmploymentEndYear: 8,
  horizonYears: 30,
  longTermCare: false,
  cushionYears: 5,
};

export const DEMO_ASSUMPTIONS = {
  inflation: 0.03,
  medicalInflationExtra: 0.02,
  irmaa: true,
  montecarlo: { runs: 300, confidence: 0.9 },
  returns: {
    pessimistic: { bond: 0.0, stock: 0.02, condo: -0.01, condoCostsExtra: 0.01 },
    expected: { bond: 0.015, stock: 0.05, condo: 0.01, condoCostsExtra: 0 },
    optimistic: { bond: 0.025, stock: 0.07, condo: 0.03, condoCostsExtra: 0 },
  },
};

export const CURRENT_YEAR = 2026;
