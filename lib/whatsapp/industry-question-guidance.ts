import { hyperlocalService } from "@/lib/categories/hyperlocal-industries";

export type QuoteQuestionGuidance = {
  context: string;
  oneSupplierQuestion: string;
  allSuppliersQuestion: string;
};

type GuidanceInput = {
  categorySlug: string;
  parentSlug?: string | null;
};

const windowGuidanceByCategory: Record<string, QuoteQuestionGuidance> = {
  "composite-doors": {
    context: "door style, glazing and final specification",
    oneSupplierQuestion: "does your price include the requested door style, glazing and hardware?",
    allSuppliersQuestion: "will you confirm the final specification before the order is placed?",
  },
  "patio-sliding-doors": {
    context: "opening layout, threshold and glazing",
    oneSupplierQuestion: "does your price include the requested threshold, glazing and opening layout?",
    allSuppliersQuestion: "is a final survey or size check required before ordering?",
  },
  "roof-lanterns": {
    context: "internal opening size, frame and finish",
    oneSupplierQuestion: "does your price include the specified frame, glazing and colour?",
    allSuppliersQuestion: "will you verify the internal opening size before manufacture?",
  },
  "roof-glass": {
    context: "internal opening size and glass build-up",
    oneSupplierQuestion: "does your price include the specified glass build-up and delivery?",
    allSuppliersQuestion: "will you verify the internal opening dimensions before manufacture?",
  },
  "glass-units": {
    context: "unit sizes, glass build-up and spacer",
    oneSupplierQuestion: "does your price include the specified glass build-up, spacer and delivery?",
    allSuppliersQuestion: "can you confirm the unit sizes and specification before manufacture?",
  },
  "toughened-laminated-glass": {
    context: "safety-glass build-up and certification",
    oneSupplierQuestion: "does your price include the specified toughened or laminated build-up?",
    allSuppliersQuestion: "can you confirm the safety-glass specification and delivery date?",
  },
  "mirrors-splashbacks": {
    context: "glass finish, processing and template",
    oneSupplierQuestion: "does your price include the requested finish, edgework and cut-outs?",
    allSuppliersQuestion: "do you need a template or final dimensions before manufacture?",
  },
};

const pheGuidanceByCategory: Record<string, QuoteQuestionGuidance> = {
  "boilers-heating-packages": {
    context: "equipment, controls and ancillaries",
    oneSupplierQuestion: "does your price include the controls, flue and listed ancillaries?",
    allSuppliersQuestion: "can you meet the required delivery date for the complete package?",
  },
  "heat-pumps": {
    context: "heat-pump package, controls and design assumptions",
    oneSupplierQuestion: "what equipment, controls and ancillaries are included in your price?",
    allSuppliersQuestion: "what design information must be confirmed before the package is ordered?",
  },
  "cylinders-hot-water-storage": {
    context: "capacity, coil arrangement and fittings",
    oneSupplierQuestion: "does your price include the specified cylinder, coils and required fittings?",
    allSuppliersQuestion: "can you confirm the model and delivery date you are quoting?",
  },
  "underfloor-heating": {
    context: "floor build-up, zones and controls",
    oneSupplierQuestion: "does your price include the pipe, manifolds, controls and design layout?",
    allSuppliersQuestion: "what floor-build-up details must be confirmed before ordering?",
  },
  "radiators-heat-emitters": {
    context: "sizes, outputs, valves and finish",
    oneSupplierQuestion: "does your price include the specified outputs, valves and finish?",
    allSuppliersQuestion: "can you confirm the quoted models and delivery date?",
  },
  "pipework-fittings": {
    context: "pipe system, sizes and quantities",
    oneSupplierQuestion: "does your price include every pipe size and fitting on the schedule?",
    allSuppliersQuestion: "are any scheduled items excluded or substituted?",
  },
  "valves-heating-controls": {
    context: "valve types, sizes and controls",
    oneSupplierQuestion: "does your price include every valve, actuator and control listed?",
    allSuppliersQuestion: "are any items excluded or being offered as alternatives?",
  },
  "pumps-pressurisation": {
    context: "pump duty, controls and accessories",
    oneSupplierQuestion: "does your price include the controls and accessories for the stated duty?",
    allSuppliersQuestion: "what duty information must be confirmed before ordering?",
  },
  "mechanical-plant-packages": {
    context: "plant schedule, controls and package exclusions",
    oneSupplierQuestion: "what is included and excluded from your mechanical package price?",
    allSuppliersQuestion: "can you meet the required date for the complete scheduled package?",
  },
};

const transportGuidance: QuoteQuestionGuidance = {
  context: "collection, access and handling",
  oneSupplierQuestion: "does your price include loading help, stairs and unloading?",
  allSuppliersQuestion: "can you confirm the collection time and delivery date?",
};

const hyperlocalGuidanceByIndustry: Record<string, QuoteQuestionGuidance> = {
  "automotive-mobile-services": {
    context: "call-out, diagnosis, parts and timing",
    oneSupplierQuestion: "does your price include the call-out and diagnosis?",
    allSuppliersQuestion: "when can you attend, and are parts included or quoted separately?",
  },
  "plumbing-heating-drainage": {
    context: "call-out, labour, parts and attendance",
    oneSupplierQuestion: "does your price include the call-out, labour and parts?",
    allSuppliersQuestion: "when can you attend, and what might be charged separately?",
  },
  "cleaning-clearance-property-care": {
    context: "scope, labour, materials and disposal",
    oneSupplierQuestion: "what exactly is included in your cleaning or clearance price?",
    allSuppliersQuestion: "does your price include materials, removal and disposal where needed?",
  },
  "garden-outdoor-services": {
    context: "materials, access and waste removal",
    oneSupplierQuestion: "does your price include materials and waste removal?",
    allSuppliersQuestion: "when can you do the work, and what is excluded from the price?",
  },
  "appliance-repair-home-equipment": {
    context: "diagnosis, labour, parts and guarantee",
    oneSupplierQuestion: "does your price include diagnosis, labour and parts?",
    allSuppliersQuestion: "is there a call-out charge and what repair guarantee is included?",
  },
  "locksmith-security-access": {
    context: "call-out, parts, VAT and attendance",
    oneSupplierQuestion: "does your price include the call-out, parts and VAT?",
    allSuppliersQuestion: "when can you attend, and could any extra charge apply?",
  },
};

const defaultWindowsGuidance: QuoteQuestionGuidance = {
  context: "material, colour, glazing and delivery",
  oneSupplierQuestion: "does your price include the requested colour, glazing and delivery?",
  allSuppliersQuestion: "do you need a final survey or size check before ordering?",
};

const defaultGuidance: QuoteQuestionGuidance = {
  context: "scope, timing and price inclusions",
  oneSupplierQuestion: "what exactly is included and excluded from your price?",
  allSuppliersQuestion: "can you meet the requested date with the stated specification?",
};

export function quoteQuestionGuidance(input: GuidanceInput): QuoteQuestionGuidance {
  const hyperlocal = hyperlocalService(input.categorySlug);
  if (hyperlocal) return hyperlocalGuidanceByIndustry[hyperlocal.industry.slug] ?? defaultGuidance;
  if (input.parentSlug === "plumbing-heating-mechanical") {
    return pheGuidanceByCategory[input.categorySlug] ?? {
      context: "equipment, specification and delivery",
      oneSupplierQuestion: "what equipment, controls and ancillaries are included in your price?",
      allSuppliersQuestion: "can you meet the required date for the complete specified package?",
    };
  }
  if (input.parentSlug === "transport-delivery-removals") return transportGuidance;
  if (input.parentSlug === "windows") return windowGuidanceByCategory[input.categorySlug] ?? defaultWindowsGuidance;
  return defaultGuidance;
}

export function quoteQuestionWhatsAppHelp(input: GuidanceInput, quoteLabel = "B") {
  const guidance = quoteQuestionGuidance(input);
  return [
    `Useful questions for this ${guidance.context} request:`,
    `ASK ${quoteLabel} ${guidance.oneSupplierQuestion}`,
    `ASK ALL ${guidance.allSuppliersQuestion}`,
  ].join("\n");
}
