interface CartonOptimizationResult {
  units: number;
  l: number;
  w: number;
  h: number;
  kg: number;
  cbm: number;
  cbmPerUnit: number;
  cbfPerUnit: number;
  build: string;
  warnings?: string[];
}

export function optimizeCarton(length: number, width: number, height: number, weight: number): CartonOptimizationResult | null {
  const toInches = 0.393701;
  const toPounds = 2.20462;
  const toCm = 1 / toInches;
  const toKg = 1 / toPounds;
  const CBM_TO_CBF = 35.3147;
  const WALL_CM = 1.0;
  const WALL_IN = WALL_CM * toInches;

  const l = length * toInches;
  const w = width * toInches;
  const h = height * toInches;
  const unitWeightLb = weight * toPounds;

  // Standard restrictions
  const MAX_UNITS = 150;
  const MAX_LENGTH_IN = 23.25;
  const MAX_WIDTH_HEIGHT_IN = 23.25;
  const MAX_WEIGHT_LB = 21 * toPounds;

  let best: CartonOptimizationResult | null = null;
  let bestScore = Infinity;
  let bestCubeScore = Infinity;
  let warnings: string[] = [];

  const permutations = [
    [l, w, h], [l, h, w],
    [w, l, h], [w, h, l],
    [h, l, w], [h, w, l]
  ];

  for (const [pl, pw, ph] of permutations) {
    const maxFitL = Math.floor(MAX_LENGTH_IN / pl);
    const maxFitW = Math.floor(MAX_WIDTH_HEIGHT_IN / pw);
    const maxFitH = Math.floor(MAX_WIDTH_HEIGHT_IN / ph);

    for (let countL = 1; countL <= maxFitL; countL++) {
      for (let countW = 1; countW <= maxFitW; countW++) {
        for (let countH = 1; countH <= maxFitH; countH++) {
          const units = countL * countW * countH;
          if (units > MAX_UNITS) continue;

          const usedL = countL * pl;
          const usedW = countW * pw;
          const usedH = countH * ph;

          const extL = usedL + 2 * WALL_IN;
          const extW = usedW + 2 * WALL_IN;
          const extH = usedH + 2 * WALL_IN;

          if (extL > MAX_LENGTH_IN || extW > MAX_WIDTH_HEIGHT_IN || extH > MAX_WIDTH_HEIGHT_IN) continue;

          const surfaceArea = 2 * (usedL * usedW + usedL * usedH + usedW * usedH);
          const cartonWeightLb = surfaceArea * 0.0013;
          const totalWeightLb = units * unitWeightLb + cartonWeightLb;
          if (totalWeightLb > MAX_WEIGHT_LB) continue;

          const cartonWeightKg = totalWeightLb * toKg;

          const cmL = extL * toCm;
          const cmW = extW * toCm;
          const cmH = extH * toCm;
          const volumeCbm = (cmL * cmW * cmH) / 1e6;
          const cbmPerUnit = volumeCbm / units;
          const cbfPerUnit = cbmPerUnit * CBM_TO_CBF;

          const billedCbm = Math.max(volumeCbm, cartonWeightKg / 363);
          const billedCbmPerUnit = billedCbm / units;

          const dims = [cmL, cmW, cmH];
          const avg = (cmL + cmW + cmH) / 3;
          const stdev = Math.sqrt(dims.map(d => Math.pow(d - avg, 2)).reduce((a, b) => a + b) / 3);

          const isBetter =
            billedCbmPerUnit < bestScore ||
            (Math.abs(billedCbmPerUnit - bestScore) < 1e-8 && stdev < bestCubeScore);

          if (isBetter) {
            bestScore = billedCbmPerUnit;
            bestCubeScore = stdev;
            best = {
              units,
              l: cmL,
              w: cmW,
              h: cmH,
              kg: cartonWeightKg,
              cbm: volumeCbm,
              cbmPerUnit,
              cbfPerUnit,
              build: countL + " × " + countW + " × " + countH
            };
          }
        }
      }
    }
  }

  // Check for warnings after optimization
  if (best) {
    // Check if product dimensions exceed efficient limits
    if (l > 20 || w > 20 || h > 20) {
      warnings.push("Product dimensions exceed 20 inches - optimization may be less efficient");
    }
    
    // Check if product dimensions exceed standard limits
    if (l > 25 || w > 25 || h > 25) {
      warnings.push("Product dimensions exceed 25 inches - may not optimize efficiently");
    }
    
    // Check if product weight exceeds standard limits
    if (unitWeightLb > 15) {
      warnings.push("Product weight exceeds 15 lbs - may require special handling");
    }
    
    best.warnings = warnings;
  }

  return best;
}