import { solveSpend } from './model.js';
import { solveSpendMonteCarlo, isMonteCarlo } from './montecarlo.js';

export function solve(inputs, scenario, assumptions) {
  return isMonteCarlo(scenario)
    ? solveSpendMonteCarlo(inputs, scenario, assumptions)
    : solveSpend(inputs, scenario, assumptions);
}
