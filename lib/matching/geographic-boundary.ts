/**
 * Coordinates are stored to six decimal places. This sub-foot tolerance only
 * absorbs the resulting numeric rounding at an exact plan boundary; it must
 * never be used as additional commercial radius.
 */
export const GEOGRAPHIC_BOUNDARY_EPSILON_MILES = 0.0001;

export function isWithinGeographicRadius(distanceMiles: number, permittedRadiusMiles: number) {
  return Number.isFinite(distanceMiles)
    && Number.isFinite(permittedRadiusMiles)
    && distanceMiles <= permittedRadiusMiles + GEOGRAPHIC_BOUNDARY_EPSILON_MILES;
}

export function isCoverageBoundaryWithinGeographicRadius(
  centreOffsetMiles: number,
  coverageRadiusMiles: number,
  permittedRadiusMiles: number,
) {
  return Number.isFinite(centreOffsetMiles)
    && Number.isFinite(coverageRadiusMiles)
    && coverageRadiusMiles >= 0
    && isWithinGeographicRadius(centreOffsetMiles + coverageRadiusMiles, permittedRadiusMiles);
}
