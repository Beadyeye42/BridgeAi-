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
