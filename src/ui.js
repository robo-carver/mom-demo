import { saleTaxEstimate } from './model.js';
import { solve } from './compute.js';
import { renderChart } from './chart.js';
import { DEMO_INPUTS, DEMO_SCENARIO, DEMO_ASSUMPTIONS, CURRENT_YEAR } from './defaults.js';

const STORAGE_KEY = 'mom-demo-state-v1';

const clone = (o) => JSON.parse(JSON.stringify(o));
const dollars = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (f) => `${Math.round(f * 100)}%`;
const $ = (sel, root = document) => root.querySelector(sel);

function loadState() {
  const fresh = { inputs: clone(DEMO_INPUTS), scenario: clone(DEMO_SCENARIO), assumptions: clone(DEMO_ASSUMPTIONS), pinned: null };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.inputs && saved?.scenario && saved?.assumptions) return { ...fresh, ...saved };
  } catch { /* fall through to fresh state */ }
  return fresh;
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

const state = loadState();

// The math runs in a worker so sliders stay smooth. Only the newest request
// gets rendered; stale answers are dropped.
// Browsers without module workers (older Firefox on Android among them) fail
// asynchronously rather than throwing, so any error or a long silence drops
// back to computing on the main thread for good.
const WORKER_TIMEOUT_MS = 6000;
const solver = (() => {
  let worker = null;
  let latest = 0;
  const pending = new Map();

  const onMainThread = (request) => ({
    id: request.id,
    result: solve(request.inputs, request.scenario, request.assumptions),
    pinnedResult: request.pinned ? solve(request.inputs, request.pinned, request.assumptions) : null,
  });
  const abandonWorker = () => {
    if (!worker) return;
    worker.terminate();
    worker = null;
    for (const [id, { request, resolve, timer }] of pending) {
      clearTimeout(timer);
      pending.delete(id);
      if (id === latest) resolve(onMainThread(request));
    }
  };

  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onerror = abandonWorker;
    worker.onmessageerror = abandonWorker;
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      if (data.id === latest) entry.resolve(data);
    };
  } catch { worker = null; }

  return (inputs, scenario, assumptions, pinned) => {
    latest += 1;
    const request = { id: latest, inputs, scenario, assumptions, pinned };
    if (!worker) return Promise.resolve(onMainThread(request));
    return new Promise((resolve) => {
      const timer = setTimeout(abandonWorker, WORKER_TIMEOUT_MS);
      pending.set(request.id, { request, resolve, timer });
      worker.postMessage(request);
    });
  };
})();

let renderQueued = false;

function update(mutate) {
  mutate(state);
  saveState(state);
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderResults(); });
}

// ---------- results ----------

function describeScenario(s) {
  const condo = { keep: 'keep renting it out', sell: `sell in year ${s.condoYear}`, movein: `move in year ${s.condoYear}` }[s.condoPlan];
  const markets = s.returns === 'montecarlo' ? 'replayed history' : `${s.returns} markets`;
  return `${markets}, ${condo}, 401k ${s.retirementStockPct}% stocks, to age ${state.inputs.age + s.horizonYears}${s.longTermCare ? ', with care' : ''}`;
}

async function renderResults() {
  const { inputs, scenario, assumptions } = state;
  renderSaleNote();
  $('#headline').classList.add('stale');
  $('#sticky').classList.add('stale');
  const { result, pinnedResult } = await solver(inputs, scenario, assumptions, state.pinned);
  $('#headline').classList.remove('stale');
  $('#sticky').classList.remove('stale');
  renderHeadline(result, pinnedResult);

  const marks = [];
  if (scenario.condoPlan !== 'keep') marks.push({ year: scenario.condoYear, label: scenario.condoPlan === 'sell' ? 'sell' : 'move in' });
  if (scenario.longTermCare) marks.push({ year: Math.max(0, scenario.horizonYears - inputs.longTermCare.years), label: 'care' });
  renderChart($('#chart'), { rows: result.rows, band: result.band, pinned: pinnedResult, startAge: inputs.age, marks });
  $('#legend-pin').hidden = !state.pinned;
  $('#legend-band').hidden = !result.band;
  $('#legend-stacked').hidden = !!result.band;
  renderTable(result.rows);
}

function confidenceNote(result) {
  if (!result.band) return '';
  const conf = Math.round(state.assumptions.montecarlo.confidence * 100);
  const share = result.ranOut >= 0.005 ? pct(result.ranOut) : 'fewer than 1%';
  const dry = result.ranOut > 0 ? ` It runs completely dry in ${share} of them.` : '';
  return ` Holds up in ${conf}% of ${result.runs} replays of market history since 1928.${dry}`;
}

function renderSticky(result, pinnedResult) {
  const main = result.feasible
    ? `${dollars(result.monthlySpend + currentRent())}<small> / month</small>`
    : `<span class="warn">Runs out<small> in year ${result.failYear ?? state.scenario.horizonYears}</small></span>`;
  const pinned = pinnedResult
    ? `<span class="pin-num">pinned ${pinnedResult.feasible ? dollars(pinnedResult.monthlySpend + state.inputs.rentPaidMonthly) : 'runs out'}</span>`
    : '';
  $('#sticky').innerHTML = `<span>${main}</span>${pinned}`;
}

function currentRent() {
  const { inputs, scenario } = state;
  return scenario.condoPlan === 'movein' && scenario.condoYear === 0 ? 0 : inputs.rentPaidMonthly;
}

function renderHeadline(result, pinnedResult) {
  const { inputs, scenario } = state;
  const el = $('#headline');
  renderSticky(result, pinnedResult);
  if (!result.feasible) {
    const year = result.failYear ?? scenario.horizonYears;
    el.innerHTML = `
      <div class="headline warn">Runs out<small> in year ${year}, age ${inputs.age + year}</small></div>
      <div class="sub">Even with nothing spent beyond rent and medical${result.band ? `, in more than ${100 - Math.round(state.assumptions.montecarlo.confidence * 100)}% of replays of market history` : ''}. ${scenario.condoPlan === 'keep' ? 'The condo is still owned at that point.' : ''}</div>
      ${pinnedResult ? pinnedLine(pinnedResult) : ''}`;
    return;
  }
  const rentNow = currentRent();
  const total = result.monthlySpend + rentNow;
  const lastRow = result.rows[result.rows.length - 1];
  const rentShareNow = total > 0 ? rentNow / total : 0;
  const rentLater = lastRow.expenses.rentPaid / 12;
  const rentShareLater = rentLater + result.monthlySpend > 0 ? rentLater / (rentLater + result.monthlySpend) : 0;
  el.innerHTML = `
    <div class="headline">${dollars(total)}<small> / month, in today's dollars</small></div>
    <div class="sub">${rentNow > 0 ? `${dollars(result.monthlySpend)} for everything except rent and medical` : 'For everything except medical'}, through age ${inputs.age + scenario.horizonYears}, with ${scenario.cushionYears} years of cushion left.${confidenceNote(result)}</div>
    <div class="rent-bar"><div style="width:${rentShareNow * 100}%"></div></div>
    <div class="sub">Rent is ${pct(rentShareNow)} of the budget today${rentLater > 0 ? `, ${pct(rentShareLater)} by the end` : ', and gone once she moves in'}.</div>
    ${pinnedResult ? pinnedLine(pinnedResult) : ''}`;
}

function pinnedLine(pinnedResult) {
  const pinnedTotal = pinnedResult.feasible ? pinnedResult.monthlySpend + state.inputs.rentPaidMonthly : 0;
  const label = pinnedResult.feasible ? `${dollars(pinnedTotal)} / month` : 'runs out';
  return `<div class="delta">Pinned: ${label}. <span class="sub">${describeScenario(state.pinned)}</span></div>`;
}

function renderTable(rows) {
  const cols = [
    ['Age', (r) => r.age],
    ['Income', (r) => dollars(r.income.wages + r.income.selfEmployment + r.income.socialSecurity)],
    ['Condo net', (r) => dollars(r.income.rentIncome - r.expenses.ownerCosts - r.expenses.mortgage + r.income.saleProceeds)],
    ['Rent', (r) => dollars(r.expenses.rentPaid)],
    ['Medical', (r) => dollars(r.expenses.medical + r.expenses.longTermCare)],
    ['Taxes', (r) => dollars(r.taxes.federal + r.taxes.state)],
    ['From 401k', (r) => dollars(r.withdrawals.fromRetirement)],
    ['401k', (r) => dollars(r.balances.retirement)],
    ['Brokerage', (r) => dollars(r.balances.brokerage)],
    ['Condo', (r) => dollars(r.balances.condoEquity)],
  ];
  $('#table').innerHTML = `<table><thead><tr>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map(([, f]) => `<td>${f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderSaleNote() {
  const est = saleTaxEstimate(state.inputs, state.scenario);
  $('#sale-note').innerHTML = `
    Selling today: gain of about ${dollars(est.gain)}, of which ${dollars(est.recapturedDepreciation)} is depreciation being taxed back.
    Estimated tax ${dollars(est.federal)} federal plus ${dollars(est.state)} to Illinois.
    If it were her main home for two of the last five years, the $250,000 exclusion would save about ${dollars(est.exclusionSavings)}.`;
}

// ---------- knobs ----------

function segmented(options, current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.classList.toggle('on', value === current);
    b.addEventListener('click', () => {
      onPick(value);
      [...wrap.children].forEach((c) => c.classList.toggle('on', c === b));
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function slider({ label, min, max, step = 1, value, format, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  wrap.innerHTML = `<label>${label}<span class="value"></span></label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
  const input = $('input', wrap);
  const show = () => { $('.value', wrap).textContent = format(Number(input.value)); };
  input.addEventListener('input', () => { onChange(Number(input.value)); show(); });
  show();
  return wrap;
}

function yearLabel(year) {
  return `year ${year}, age ${state.inputs.age + year} (${CURRENT_YEAR + year})`;
}

function renderKnobs() {
  const { scenario, inputs } = state;
  const el = $('#knobs');
  el.innerHTML = '<h2>Try things</h2>';
  const add = (title, node) => {
    const k = document.createElement('div');
    k.className = 'knob';
    if (title) k.innerHTML = `<label>${title}</label>`;
    k.appendChild(node);
    el.appendChild(k);
    return node;
  };

  add('Markets', segmented(
    [['pessimistic', 'Pessimistic'], ['expected', 'Expected'], ['optimistic', 'Optimistic'], ['montecarlo', 'History']],
    scenario.returns, (v) => update((s) => { s.scenario.returns = v; }),
  ));

  add('The condo', segmented(
    [['keep', 'Keep renting out'], ['sell', 'Sell'], ['movein', 'Move in']],
    scenario.condoPlan, (v) => { update((s) => { s.scenario.condoPlan = v; }); renderKnobs(); },
  ));
  if (scenario.condoPlan !== 'keep') {
    el.appendChild(slider({
      label: scenario.condoPlan === 'sell' ? 'Sell in' : 'Move in during', min: 0, max: 25, value: scenario.condoYear,
      format: yearLabel, onChange: (v) => update((s) => { s.scenario.condoYear = v; }),
    }));
  }
  if (scenario.condoPlan === 'sell') {
    el.appendChild(slider({
      label: 'Sale money invested in stocks', min: 0, max: 100, step: 5, value: scenario.proceedsStockPct,
      format: (v) => `${v}% stocks, ${100 - v}% bonds`, onChange: (v) => update((s) => { s.scenario.proceedsStockPct = v; }),
    }));
  }
  el.appendChild(slider({
    label: '401k invested in stocks', min: 0, max: 100, step: 5, value: scenario.retirementStockPct,
    format: (v) => `${v}% stocks, ${100 - v}% bonds`, onChange: (v) => update((s) => { s.scenario.retirementStockPct = v; }),
  }));
  el.appendChild(slider({
    label: 'Paycheck stops', min: 0, max: 20, value: scenario.employmentEndYear,
    format: (v) => (v === 0 ? 'already stopped' : `after ${yearLabel(v)}`), onChange: (v) => update((s) => { s.scenario.employmentEndYear = v; }),
  }));
  el.appendChild(slider({
    label: 'Self-employment stops', min: 0, max: 20, value: scenario.selfEmploymentEndYear,
    format: (v) => (v === 0 ? 'already stopped' : `after ${yearLabel(v)}`), onChange: (v) => update((s) => { s.scenario.selfEmploymentEndYear = v; }),
  }));
  el.appendChild(slider({
    label: 'Plan to age', min: 20, max: 35, value: scenario.horizonYears,
    format: (v) => `${inputs.age + v}`, onChange: (v) => update((s) => { s.scenario.horizonYears = v; }),
  }));
  el.appendChild(slider({
    label: 'Cushion at the end', min: 0, max: 10, value: scenario.cushionYears,
    format: (v) => `${v} years of spending`, onChange: (v) => update((s) => { s.scenario.cushionYears = v; }),
  }));
  add(`Long-term care (${inputs.longTermCare.years} years at ${dollars(inputs.longTermCare.monthly)}/month)`, segmented(
    [[false, 'Not included'], [true, 'Included']],
    scenario.longTermCare, (v) => update((s) => { s.scenario.longTermCare = v; }),
  ));

  const pin = document.createElement('button');
  pin.className = `pin ${state.pinned ? 'on' : ''}`;
  pin.textContent = state.pinned ? 'Unpin comparison' : 'Pin this scenario to compare';
  pin.addEventListener('click', () => {
    update((s) => { s.pinned = s.pinned ? null : clone(s.scenario); });
    renderKnobs();
  });
  add('', pin);
}

// ---------- details ----------

function field({ path, label, kind = 'money', root = 'inputs' }) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const value = getPath(state[root], path);
  const shown = kind === 'pct' ? Math.round(value * 10000) / 100 : value;
  const step = kind === 'pct' ? 0.1 : kind === 'int' ? 1 : 1;
  wrap.innerHTML = `<label>${label}${kind === 'pct' ? ' (%)' : ''}</label><input type="number" inputmode="decimal" step="${step}" value="${shown}">`;
  $('input', wrap).addEventListener('change', (e) => {
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    update((s) => setPath(s[root], path, kind === 'pct' ? n / 100 : n));
    if (path === 'age' || path.startsWith('longTermCare')) renderKnobs();
  });
  return wrap;
}

function listEditor({ path, withLabel }) {
  const wrap = document.createElement('div');
  const render = () => {
    const items = getPath(state.inputs, path);
    wrap.innerHTML = `<div class="list-row"><span class="note">Year</span><span class="note">Amount</span><span class="note">${withLabel ? 'What' : ''}</span><span></span></div>`;
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `<input type="number" inputmode="numeric" value="${item.year}"><input type="number" inputmode="decimal" value="${item.amount}">
        ${withLabel ? `<input type="text" value="${item.label ?? ''}">` : '<span></span>'}<button type="button" aria-label="Remove">×</button>`;
      const [year, amount, label] = row.querySelectorAll('input');
      year.addEventListener('change', () => update(() => { item.year = Number(year.value); }));
      amount.addEventListener('change', () => update(() => { item.amount = Number(amount.value); }));
      label?.addEventListener('change', () => update(() => { item.label = label.value; }));
      $('button', row).addEventListener('click', () => { update(() => items.splice(i, 1)); render(); });
      wrap.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'link';
    addBtn.textContent = 'Add one';
    addBtn.addEventListener('click', () => { update(() => items.push({ year: 5, amount: 10000, label: '' })); render(); });
    wrap.appendChild(addBtn);
  };
  render();
  return wrap;
}

function section(title, children, extraHtml = '') {
  const d = document.createElement('details');
  d.innerHTML = `<summary>${title}</summary>${extraHtml}`;
  children.forEach((c) => d.appendChild(c));
  return d;
}

function returnsEditor() {
  const wrap = document.createElement('div');
  wrap.className = 'returns-grid';
  const rows = [['bond', 'Bond fund'], ['stock', 'Stock fund'], ['condo', 'Condo value'], ['condoCostsExtra', 'Rent and condo costs']];
  const cols = ['pessimistic', 'expected', 'optimistic'];
  wrap.innerHTML = `<span></span>${cols.map((c) => `<span>${c[0].toUpperCase() + c.slice(1, 4)}.</span>`).join('')}`;
  for (const [key, label] of rows) {
    wrap.insertAdjacentHTML('beforeend', `<span>${label}</span>`);
    for (const col of cols) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.5';
      input.inputMode = 'decimal';
      input.value = Math.round(state.assumptions.returns[col][key] * 1000) / 10;
      input.addEventListener('change', () => update((s) => { s.assumptions.returns[col][key] = Number(input.value) / 100; }));
      wrap.appendChild(input);
    }
  }
  return wrap;
}

const NOTES = `
<h3>Why the 401k is drawn first</h3>
<p>Each year the plan pulls from the 401k until her taxable income reaches the top of the 12% federal bracket, then takes the rest from savings. Money left in a 401k is taxed as ordinary income whenever it comes out, and at 73 the government forces it out on a schedule. Filling the cheap brackets every year drains it at 10% and 12% instead of getting pushed into 22% later. Savings and brokerage money is only taxed on its gains, at 0% or 15%, so it is the better pot to leave for last.</p>
<h3>Selling the condo</h3>
<p>Because it has been a rental since ${DEMO_INPUTS.condo.rentedSinceYear}, the depreciation the IRS assumes she took gets taxed back at up to 25% when it sells, whether or not she ever claimed it. The rest of the gain is taxed at 15% or 20%. Illinois takes 4.95% of the whole gain from a non-resident. The $250,000 exclusion only applies if she lived there as her main home for two of the five years before the sale. Moving in and selling later is the way to earn that.</p>
<h3>Moving in</h3>
<p>Her rent stops, the rental income stops, and she becomes an Illinois resident. Illinois does not tax Social Security or 401k withdrawals, so only her work income would be taxed there. Chicago property tax and the condo's assessments continue.</p>
<h3>Medicare surcharge</h3>
<p>Medicare premiums step up when income two years earlier was above about $109,000. A condo sale or a large 401k withdrawal shows up as a premium bump two years later. The plan includes it.</p>
<h3>Social Security earnings test</h3>
<p>Until she reaches 67, Social Security withholds $1 for every $2 earned above roughly $24,500 a year from work. The withheld amount comes back as a higher benefit later, so the plan ignores it, but it can pinch the monthly cash flow now.</p>
<h3>Replay history</h3>
<p>The fourth markets setting stops assuming one steady return. For each replay it draws a real year at random from 1928 to 2025, with the S&amp;P 500 (with dividends), the 10-year Treasury bond and home prices moving together the way they actually did that year, after inflation. It does that for every year of the plan, runs the whole projection, and finds the most she could have spent in that replay. The headline is the spend that holds up in 90% of the replays, not the average. An average would be right about half the time, which is the wrong bet for a retiree. The chart shows the middle 80% of outcomes as a band and the typical path as a line. The same replays are reused every time, so the number does not wobble as you drag sliders.</p>
<h3>Simplifications</h3>
<p>Everything is in today's dollars. Brokerage gains are taxed only when withdrawn, not on yearly dividends. Rental losses are assumed to offset other income. Federal brackets and the standard deduction use 2026 figures, indexed with inflation. The temporary 2025 to 2028 senior deduction is left out. Medical premiums grow 2% faster than inflation by default.</p>`;

function renderDetails() {
  const el = $('#details');
  el.innerHTML = '<h2>Her numbers</h2><p class="note">Stored only on this phone.</p>';
  el.appendChild(section('Income and savings', [
    field({ path: 'age', label: 'Her age', kind: 'int' }),
    field({ path: 'socialSecurityMonthly', label: 'Social Security per month' }),
    field({ path: 'employment.monthly', label: 'Paycheck per month' }),
    field({ path: 'selfEmployment.monthly', label: 'Self-employment income per month' }),
    field({ path: 'rentPaidMonthly', label: 'Rent she pays per month' }),
    field({ path: 'rentPaidIncrease', label: 'Yearly rent increase', kind: 'pct' }),
    field({ path: 'retirementBalance', label: '401k balance' }),
    field({ path: 'savingsBalance', label: 'Savings and other accounts' }),
  ]));
  el.appendChild(section('Condo', [
    field({ path: 'condo.value', label: 'Value today' }),
    field({ path: 'condo.mortgageBalance', label: 'Mortgage balance' }),
    field({ path: 'condo.mortgageRate', label: 'Mortgage rate', kind: 'pct' }),
    field({ path: 'condo.mortgageYearsLeft', label: 'Years left on mortgage', kind: 'int' }),
    field({ path: 'condo.rentIncomeMonthly', label: 'Rent collected per month' }),
    field({ path: 'condo.vacancyRate', label: 'Share of the year vacant', kind: 'pct' }),
    field({ path: 'condo.hoaMonthly', label: 'HOA per month' }),
    field({ path: 'condo.propertyTaxAnnual', label: 'Property tax per year' }),
    field({ path: 'condo.insuranceAnnual', label: 'Insurance per year' }),
    field({ path: 'condo.maintenanceAnnual', label: 'Repairs per year' }),
    field({ path: 'condo.costBasis', label: 'Purchase price plus improvements' }),
    field({ path: 'condo.rentedSinceYear', label: 'Rented since (year)', kind: 'int' }),
    field({ path: 'condo.landShare', label: 'Land share of purchase price', kind: 'pct' }),
    field({ path: 'condo.sellingCostRate', label: 'Selling costs', kind: 'pct' }),
    Object.assign(document.createElement('label'), { textContent: 'Special assessments', className: 'note' }),
    listEditor({ path: 'condo.specialAssessments' }),
  ], '<p class="note" id="sale-note"></p>'));
  el.appendChild(section('Medical and one-time costs', [
    field({ path: 'medical.premiumMonthly', label: 'Medicare and supplement per month' }),
    field({ path: 'longTermCare.years', label: 'Long-term care: years at the end', kind: 'int' }),
    field({ path: 'longTermCare.monthly', label: 'Long-term care: cost per month' }),
    Object.assign(document.createElement('label'), { textContent: 'One-time costs (car, medical, family)', className: 'note' }),
    listEditor({ path: 'oneTimeExpenses', withLabel: true }),
  ]));
  el.appendChild(section('Assumptions', [
    field({ path: 'inflation', label: 'Inflation', kind: 'pct', root: 'assumptions' }),
    field({ path: 'medicalInflationExtra', label: 'Medical costs grow faster than inflation by', kind: 'pct', root: 'assumptions' }),
    Object.assign(document.createElement('p'), { textContent: 'Yearly returns above inflation, in percent.', className: 'note' }),
    returnsEditor(),
    Object.assign(document.createElement('p'), { textContent: 'Replay history', className: 'note' }),
    field({ path: 'montecarlo.runs', label: 'Number of replays', kind: 'int', root: 'assumptions' }),
    field({ path: 'montecarlo.confidence', label: 'Must hold up in this share of replays', kind: 'pct', root: 'assumptions' }),
  ]));
  el.appendChild(section('Year by year', [Object.assign(document.createElement('div'), { className: 'scroll', id: 'table' })]));
  el.appendChild(section('How the math works', [Object.assign(document.createElement('div'), { className: 'notes', innerHTML: NOTES })]));
}

$('#reset').addEventListener('click', () => {
  if (!confirm('Replace her numbers with the demo numbers?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

new IntersectionObserver(([entry]) => {
  $('#sticky').hidden = entry.isIntersecting;
}, { threshold: 0 }).observe($('#headline'));

renderKnobs();
renderDetails();
renderResults();
