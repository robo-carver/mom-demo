const W = 360;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}m` : `$${Math.round(n / 1000)}k`);

function scale(domainMax, range) {
  return (v) => range[0] + (v / domainMax) * (range[1] - range[0]);
}

export function renderChart(el, { rows, pinnedRows, startAge, marks }) {
  const total = (r) => r.balances.liquid + r.balances.condoEquity;
  const yMax = Math.max(1, ...rows.map(total), ...(pinnedRows ?? []).map(total)) * 1.05;
  const years = Math.max(rows.length, pinnedRows?.length ?? 0);
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
      <text class="axis" x="${PAD.left - 4}" y="${y(v) + 4}" text-anchor="end">${money(v)}</text>`;
  }).join('');

  const ageTicks = [];
  for (let i = 0; i < years; i += 5) {
    ageTicks.push(`<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${startAge + i}</text>`);
  }

  const markLines = (marks ?? []).map(({ year, label }) => `
    <line class="mark" x1="${x(year)}" x2="${x(year)}" y1="${PAD.top}" y2="${H - PAD.bottom}" />
    <text class="mark-label" x="${x(year) + 3}" y="${PAD.top + 10}">${label}</text>`).join('');

  const pinnedLine = pinnedRows
    ? `<polyline class="pinned" points="${pinnedRows.map((r, i) => `${x(i).toFixed(1)},${y(total(r)).toFixed(1)}`).join(' ')}" />`
    : '';

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Assets over time">
      ${gridLines}
      <g class="area-retirement">${area(retirement, () => 0)}</g>
      <g class="area-brokerage">${area(brokerage, retirement)}</g>
      <g class="area-condo">${area(total, brokerage)}</g>
      ${markLines}
      ${pinnedLine}
      ${ageTicks.join('')}
      <text class="axis" x="${W - PAD.right}" y="${H - 8}" text-anchor="end">age</text>
    </svg>`;
}
