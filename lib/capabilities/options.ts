export const STANDARD_COLOUR_OPTIONS = [
  "White",
  "Black",
  "Anthracite grey",
  "Slate grey",
  "Agate grey",
  "Chartwell green",
  "Cream",
  "Irish oak",
  "Rosewood brown",
] as const;

export const RAL_COLOUR_MARKER = "RAL colours";

export const PROFILE_SYSTEM_OPTIONS_BY_CATEGORY: Record<string, readonly string[]> = {
  "upvc-windows": ["Liniar", "Rehau", "Deceuninck", "Eurocell", "Profile 22"],
  "aluminium-windows": ["Smart Systems", "AluK", "Origin"],
};

export const PHE_MANUFACTURER_OPTIONS_BY_CATEGORY: Record<string, readonly string[]> = {
  "boilers-heating-packages": ["Worcester Bosch", "Vaillant", "Viessmann", "Ideal Heating", "Baxi", "Glow-worm", "Grant"],
  "heat-pumps": ["Mitsubishi Electric", "Daikin", "Vaillant", "Samsung", "Panasonic", "NIBE", "Grant"],
  "cylinders-hot-water-storage": ["Megaflo", "Gledhill", "Joule", "Kingspan", "OSO", "Telford"],
  "underfloor-heating": ["Polypipe", "Uponor", "Nu-Heat", "Wavin", "JG Underfloor"],
  "radiators-heat-emitters": ["Stelrad", "Myson", "Korado", "Jaga", "Kudox"],
  "pipework-fittings": ["Pegler Yorkshire", "Geberit", "Wavin", "Polypipe", "Conex Bänninger", "Uponor"],
  "valves-heating-controls": ["Danfoss", "Honeywell Home", "Drayton", "Caleffi", "ESBE", "Resideo"],
  "pumps-pressurisation": ["Grundfos", "Wilo", "DAB", "Lowara", "Flamco"],
  "mechanical-plant-packages": ["Grundfos", "Wilo", "Caleffi", "Flamco", "Hamworthy", "Remeha"],
};

export const PHE_SYSTEM_OPTIONS_BY_CATEGORY: Record<string, readonly string[]> = {
  "boilers-heating-packages": ["Gas boiler", "Oil boiler", "Electric boiler", "Hybrid heating", "Commercial boiler cascade"],
  "heat-pumps": ["Air source", "Ground source", "Monobloc", "Split", "Hybrid heat pump"],
  "cylinders-hot-water-storage": ["Vented cylinder", "Unvented cylinder", "Thermal store", "Buffer vessel", "Direct", "Indirect"],
  "underfloor-heating": ["Wet underfloor heating", "Electric underfloor heating", "Overlay system", "Screeded system", "Low-profile system"],
  "radiators-heat-emitters": ["Panel radiators", "Designer radiators", "Towel rails", "Trench heating", "Fan convectors"],
  "pipework-fittings": ["Copper", "PEX", "MLCP", "Plastic push-fit", "Carbon steel", "Stainless steel"],
  "valves-heating-controls": ["Isolation valves", "TRVs", "Balancing valves", "Mixing valves", "Zone controls", "Smart controls"],
  "pumps-pressurisation": ["Circulators", "Booster sets", "Pressurisation units", "Expansion vessels", "Condensate pumps"],
  "mechanical-plant-packages": ["Packaged plantroom", "Heating skid", "DHW package", "Booster package", "Pressurisation package"],
};

export const PHE_CATEGORY_SLUGS = new Set([
  ...Object.keys(PHE_MANUFACTURER_OPTIONS_BY_CATEGORY),
  ...Object.keys(PHE_SYSTEM_OPTIONS_BY_CATEGORY),
]);

export const TRANSPORT_CATEGORY_SLUGS = new Set([
  "man-with-a-van",
  "trade-collection-delivery",
  "same-day-courier",
  "furniture-small-removals",
  "bulky-item-transport",
  "building-material-deliveries",
  "multi-drop-delivery",
]);

export const TRANSPORT_VEHICLE_OPTIONS = [
  "Small van",
  "Short-wheelbase van",
  "Long-wheelbase van",
  "Luton van",
  "Tail-lift van",
  "3.5-tonne flatbed",
] as const;

export const TRANSPORT_SERVICE_FEATURE_OPTIONS = [
  "Driver only",
  "Driver plus helper",
  "Two-person crew",
  "Loading and unloading",
  "Stairs handling",
  "Timed delivery",
  "Proof of delivery",
] as const;

export function isPheCapabilityCategory(slug: string) {
  return PHE_CATEGORY_SLUGS.has(slug);
}

export function isTransportCapabilityCategory(slug: string) {
  return TRANSPORT_CATEGORY_SLUGS.has(slug);
}

const VALUE_ALIASES: Record<string, string> = {
  "smart": "smart systems",
  "smarts": "smart systems",
  "alu k": "aluk",
  "alu uk": "aluk",
  "profile22": "profile 22",
};

export function normaliseCapabilityValue(value: string) {
  const normalised = value
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/[®™]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");
  return VALUE_ALIASES[normalised] ?? normalised;
}

export function isRalCode(value: string) {
  return /\bral\s*\d{4}\b/i.test(value);
}

export function isRalColourMarker(value: string) {
  return ["ral", "ral colour", "ral colours", "any ral", "any ral colour", "any ral colours"]
    .includes(normaliseCapabilityValue(value));
}

export function isStandardColour(value: string) {
  const wanted = normaliseCapabilityValue(value);
  return STANDARD_COLOUR_OPTIONS.some((colour) => normaliseCapabilityValue(colour) === wanted);
}

export function includesCapabilityValue(values: readonly string[], option: string) {
  const wanted = normaliseCapabilityValue(option);
  return values.some((value) => normaliseCapabilityValue(value) === wanted);
}
