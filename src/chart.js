const W = 360;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}m` : `$${Math.round(n / 1000)}k`);

function scale(domainMax, range) {
  return (v) => range[0] + (v / domainMax) * (range[1] - range[0]);
}

// `band` (optional) is a per-year {low, mid, high} spread; when given it is
// drawn instead of the stacked areas. `pinned` is either rows or a band.
export function renderChart(el, { rows, band, pinned, startAge, marks }) {
  const total = (r) => r.balances.liquid + r.balances.condoEquity;
  const pinnedTotals = pinned ? (pinned.band ? pinned.band.map((b) => b.mid) : pinned.rows.map(total)) : [];
  // A lucky tail of replays can dwarf everything else; cap the chart at twice
  // the typical path so the low end stays readable.
  const ownTotals = band ? band.map((b) => b.high) : rows.map(total);
  const ownCap = band ? Math.max(...band.map((b) => b.mid)) * 2 : Infinity;
  const clipped = band && Math.max(...ownTotals) > ownCap;
  const yMax = Math.max(1, Math.min(ownCap, Math.max(...ownTotals)), ...pinnedTotals) * 1.05;
  const years = Math.max(rows.length, pinnedTotals.length);
  const x = scale(years - 1, [PAD.left, W - PAD.right]);
  const y = (v) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);

  const area = (upper, lower) => {
    const top = rows.map((r, i) => `${x(i).toFixed(1)},${y(upper(r)).toFixed(1)}`);
    const bottom = rows.map((r, i) => `${x(i).toFixed(1)},${y(lower(r)).toFixed(1)}`).reverse();
    return `<polygon points="${[...top, ...bottom].join(' ')}" />`;
  };
  const retirement = (r) => r.balances.retirement;
  const brokerage = (r) => r.balances.retirement + r.balances.brokerage;

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
    const v = yMax * f;
    return `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" />
      <text class="axis" x="${PAD.left - 4}" y="${y(v) + 4}" text-anchor="end">${money(v)}${clipped && f === 1 ? '+' : ''}</text>`;
  }).join('');

  const ageTicks = [];
  for (let i = 0; i < years; i += 5) {
    ageTicks.push(`<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${startAge + i}</text>`);
  }

  const markLines = (marks ?? []).map(({ year, label }) => `
    <line class="mark" x1="${x(year)}" x2="${x(year)}" y1="${PAD.top}" y2="${H - PAD.bottom}" />
    <text class="mark-label" x="${x(year) + 3}" y="${PAD.top + 10}">${label}</text>`).join('');

  const line = (values, cls) =>
    `<polyline class="${cls}" points="${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" />`;
  const pinnedLine = pinnedTotals.length ? line(pinnedTotals, 'pinned') : '';

  const body = band
    ? `<polygon class="band" points="${[
        ...band.map((b, i) => `${x(i).toFixed(1)},${y(b.high).toFixed(1)}`),
        ...band.map((b, i) => `${x(i).toFixed(1)},${y(b.low).toFixed(1)}`).reverse(),
      ].join(' ')}" />${line(band.map((b) => b.mid), 'median')}`
    : `<g class="area-retirement">${area(retirement, () => 0)}</g>
      <g class="area-brokerage">${area(brokerage, retirement)}</g>
      <g class="area-condo">${area(total, brokerage)}</g>`;

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Assets over time" style="overflow:hidden">
      ${gridLines}
      ${body}
      ${markLines}
      ${pinnedLine}
      ${ageTicks.join('')}
      <text class="axis" x="${W - PAD.right}" y="${H - 8}" text-anchor="end">age</text>
    </svg>`;
}
