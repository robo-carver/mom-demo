import { solve } from './compute.js';

self.onmessage = ({ data }) => {
  const { id, inputs, scenario, assumptions, pinned } = data;
  const result = solve(inputs, scenario, assumptions);
  const pinnedResult = pinned ? solve(inputs, pinned, assumptions) : null;
  self.postMessage({ id, result, pinnedResult });
};
