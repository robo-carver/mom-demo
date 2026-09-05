import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  ordinaryIncomeTax, capitalGainsTax, taxableSocialSecurity, federalTax,
  illinoisTax, irmaaMonthlySurcharge, deflate, standardDeduction,
} from '../src/tax.js';

const close = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('ordinary tax follows the brackets', () => {
  assert.equal(ordinaryIncomeTax(0), 0);
  close(ordinaryIncomeTax(12400), 1240);
  close(ordinaryIncomeTax(50400), 1240 + 38000 * 0.12);
});

test('capital gains tax stacks on ordinary income', () => {
  assert.equal(capitalGainsTax(10000, 0), 0);
  close(capitalGainsTax(10000, 49450), 1500);
  close(capitalGainsTax(10000, 45000), 5550 * 0.15);
});

test('social security taxation tiers', () => {
  assert.equal(taxableSocialSecurity(24000, 5000), 0);
  close(taxableSocialSecurity(24000, 20000), 3500);
  close(taxableSocialSecurity(24000, 40000), 0.85 * 18000 + 4500);
  close(taxableSocialSecurity(24000, 80000), 0.85 * 24000);
});

test('taxable social security never exceeds 85 percent and grows with other income', () => {
  fc.assert(fc.property(
    fc.double({ min: 0, max: 60000, noNaN: true }),
    fc.double({ min: 0, max: 300000, noNaN: true }),
    fc.double({ min: 0, max: 50000, noNaN: true }),
    (benefit, other, more) => {
      const a = taxableSocialSecurity(benefit, other);
      const b = taxableSocialSecurity(benefit, other + more);
      return a <= 0.85 * benefit + 1e-9 && b >= a - 1e-9;
    },
  ));
});

test('federal tax is monotone in each income source and never negative', () => {
  const income = () => fc.double({ min: 0, max: 200000, noNaN: true });
  fc.assert(fc.property(
    income(), income(), income(), income(), income(), income(),
    (wages, selfEmployment, rentalProfit, retirementWithdrawals, socialSecurity, capitalGains) => {
      const base = { age: 65, wages, selfEmployment, rentalProfit, retirementWithdrawals, socialSecurity, capitalGains };
      const t0 = federalTax(base).tax;
      assert.ok(t0 >= 0);
      for (const key of Object.keys(base).filter((k) => k !== 'age')) {
        const bumped = federalTax({ ...base, [key]: base[key] + 1000 }).tax;
        assert.ok(bumped >= t0 - 1e-6, `${key} lowered tax`);
      }
    },
  ));
});

test('a retiree on social security alone owes nothing', () => {
  assert.equal(federalTax({ age: 65, socialSecurity: 30000 }).tax, 0);
});

test('depreciation recapture is capped at 25 percent', () => {
  const withRecapture = federalTax({ age: 65, retirementWithdrawals: 300000, recapturedDepreciation: 100000 }).tax;
  const without = federalTax({ age: 65, retirementWithdrawals: 300000 }).tax;
  close(withRecapture - without, 25000 + 100000 * 0.038, 5);
});

test('self-employment tax applies on top of income tax', () => {
  const { tax } = federalTax({ age: 65, selfEmployment: 10000 });
  close(tax, 10000 * 0.9235 * 0.153, 1);
});

test('illinois taxes residents on work, not retirement, and non-residents on the condo only', () => {
  close(illinoisTax({ resident: false, wages: 50000, rentalProfit: 10000 }), 495);
  close(illinoisTax({ resident: true, wages: 50000, rentalProfit: 10000 }), 2970);
  assert.equal(illinoisTax({ resident: false, rentalProfit: -5000 }), 0);
});

test('irmaa tiers', () => {
  assert.equal(irmaaMonthlySurcharge(50000), 0);
  assert.equal(irmaaMonthlySurcharge(109001), 97);
  assert.equal(irmaaMonthlySurcharge(1e7), 590);
});

test('deflating a fixed nominal threshold shrinks it in real dollars', () => {
  close(deflate(25000, 0.03, 10), 25000 / 1.03 ** 10, 0.01);
  assert.equal(standardDeduction({ age: 65 }), 18150);
});
