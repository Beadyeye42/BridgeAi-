import { normalizePostcode } from "../location/postcodes";

type Numeric = number | string | { toString(): string };

export type DeliveryLocation = {
  postcode: string;
  latitude: number | null;
  longitude: number | null;
};

export type CoverageRule = {
  type: "POSTCODE" | "DISTANCE" | "NATIONWIDE";
  label: string;
  postcodePrefix: string | null;
  centrePostcode: string | null;
  radiusMiles: number | null;
  latitude: Numeric | null;
  longitude: Numeric | null;
};

export type CoverageMatch = {
  type: CoverageRule["type"];
  label: string;
  description: string;
  distanceMiles: number | null;
};

function toNumber(value: Numeric | null) {
  if (value === null) return null;
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : null;
}

function radians(degrees: number) {
  return degrees * Math.PI / 180;
}

export function distanceMiles(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusMiles = 3_958.7613;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function matchCoverageRule(rule: CoverageRule, delivery: DeliveryLocation): CoverageMatch | null {
  if (rule.type === "NATIONWIDE") {
    return { type: rule.type, label: rule.label, description: "Nationwide coverage", distanceMiles: null };
  }

  if (rule.type === "POSTCODE") {
    const prefix = rule.postcodePrefix ? normalizePostcode(rule.postcodePrefix) : "";
    if (!prefix || !normalizePostcode(delivery.postcode).startsWith(prefix)) return null;
    return { type: rule.type, label: rule.label, description: `Postcode area ${rule.postcodePrefix}`, distanceMiles: null };
  }

  const latitude = toNumber(rule.latitude);
  const longitude = toNumber(rule.longitude);
  if (latitude === null || longitude === null || delivery.latitude === null || delivery.longitude === null || rule.radiusMiles === null) return null;
  const distance = distanceMiles({ latitude, longitude }, { latitude: delivery.latitude, longitude: delivery.longitude });
  if (distance > rule.radiusMiles) return null;
  return {
    type: rule.type,
    label: rule.label,
    description: `${Math.round(distance)} miles from ${rule.label} (${rule.centrePostcode})`,
    distanceMiles: distance,
  };
}

export function bestCoverageMatch(rules: CoverageRule[], delivery: DeliveryLocation) {
  const priority: Record<CoverageRule["type"], number> = { DISTANCE: 0, POSTCODE: 1, NATIONWIDE: 2 };
  return rules
    .map((rule) => matchCoverageRule(rule, delivery))
    .filter((match): match is CoverageMatch => match !== null)
    .sort((left, right) => priority[left.type] - priority[right.type] || (left.distanceMiles ?? 0) - (right.distanceMiles ?? 0))[0] ?? null;
}
