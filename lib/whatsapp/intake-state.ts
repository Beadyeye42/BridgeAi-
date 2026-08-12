import { createHash } from "node:crypto";
import { hyperlocalService } from "@/lib/categories/hyperlocal-industries";

export const intakeQuestionKeys = [
  "BUYER_TYPE",
  "PRODUCT",
  "DELIVERY_POSTCODE",
  "REQUIRED_BY",
  "FULFILMENT",
  "CATEGORY",
  "COMPOSITE_STYLE",
  "ROOF_GLAZING_SPECIFICATION",
  "PHE_SPECIFICATION",
  "TRANSPORT_ROUTE_ITEM",
  "TRANSPORT_ACCESS",
  "TRANSPORT_HANDLING",
  "HYPERLOCAL_SERVICE",
  "SPECIFICATION",
  "REQUIREMENTS",
  "NONE",
] as const;

export type IntakeQuestionKey = (typeof intakeQuestionKeys)[number];

export type TradeClarification = {
  materialNeeded: boolean;
  colourNeeded: boolean;
  colourTerm: string | null;
};

type TradeDraft = {
  categorySlug: string | null;
  title: string | null;
  summary: string | null;
  items: Array<{ description: string; specification?: string | null }>;
};

type IntakeConversationMessage = {
  direction: "INBOUND" | "OUTBOUND";
  text: string;
};

export const MAX_UNPRODUCTIVE_TURNS = 2;

const recognisedIndustryColourPattern = /\b(?:white|black|anthracite(?: gr[ae]y)?|anthercite(?: gr[ae]y)?|antracite(?: gr[ae]y)?|slate gr[ae]y|agate gr[ae]y|chartwell(?: green)?|cream|irish oak|rosewood(?: brown)?)\b/i;
const colourMentionPattern = /\b(?:white|black|anthracite(?: gr[ae]y)?|anthercite(?: gr[ae]y)?|antracite(?: gr[ae]y)?|slate gr[ae]y|agate gr[ae]y|chartwell(?: green)?|cream|irish oak|rosewood(?: brown)?|olive(?: green)?)\b/gi;

export function isRecognisedIndustryColour(value: string | null | undefined) {
  return Boolean(value && recognisedIndustryColourPattern.test(value));
}

export function compositeDoorStylePhotoPrompt() {
  return "To match the exact composite door and make supplier pricing easier, please send a photo or screenshot of the style you want. A brochure image is perfect. If you don’t have one, reply NO PHOTO and briefly describe the style instead.";
}

export function compositeDoorPhotoDecision(draft: TradeDraft, messages: IntakeConversationMessage[]) {
  const draftEvidence = [
    draft.categorySlug,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const isCompositeDoor = /\bcomposite[-\s]+doors?\b/i.test(draftEvidence);
  const hasStyleFile = messages.some((message) => message.direction === "INBOUND"
    && /^\[Customer (?:attachment|uploaded)\b/i.test(message.text));
  const alreadyAsked = messages.some((message) => message.direction === "OUTBOUND"
    && message.text.includes("photo or screenshot of the style you want"));
  const customerHasNoPhoto = messages.some((message) => message.direction === "INBOUND"
    && /\b(?:no photo|no picture|no image|don['’]?t have (?:a )?(?:photo|picture|image)|do not have (?:a )?(?:photo|picture|image)|can['’]?t (?:send|provide) (?:a )?(?:photo|picture|image)|cannot (?:send|provide) (?:a )?(?:photo|picture|image))\b/i.test(message.text));
  const handled = hasStyleFile || alreadyAsked || customerHasNoPhoto;
  return { isCompositeDoor, hasStyleFile, alreadyAsked, customerHasNoPhoto, handled, shouldAsk: isCompositeDoor && !handled };
}

export type RoofGlazingSpecificationDecision = {
  isRoofGlazing: boolean;
  internalSizesNeeded: boolean;
  materialNeeded: boolean;
  colourNeeded: boolean;
  shouldAsk: boolean;
};

export function roofGlazingSpecificationPrompt(input: RoofGlazingSpecificationDecision) {
  const missing = [
    input.internalSizesNeeded ? "the INTERNAL opening size (width × length, preferably in mm)" : null,
    input.materialNeeded ? "the frame/material suppliers should price, such as aluminium, uPVC, timber or glass only" : null,
    input.colourNeeded ? "the colour or finish" : null,
  ].filter((value): value is string => Boolean(value));
  const fields = missing.length > 1
    ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`
    : missing[0];
  return `To help suppliers price the exact roof glazing, please provide ${fields}. Please label the measurements as INTERNAL so they are not confused with external sizes.`;
}

const pheCategorySlugs = new Set([
  "plumbing-heating-mechanical",
  "boilers-heating-packages",
  "heat-pumps",
  "cylinders-hot-water-storage",
  "underfloor-heating",
  "radiators-heat-emitters",
  "pipework-fittings",
  "valves-heating-controls",
  "pumps-pressurisation",
  "mechanical-plant-packages",
]);

const industryRootCategorySlugs = new Set([
  "windows",
  "plumbing-heating-mechanical",
  "bespoke-metal-fabrication",
  "garage-industrial-specialist-doors",
  "transport-delivery-removals",
]);

const transportCategorySlugs = new Set([
  "transport-delivery-removals",
  "man-with-a-van",
  "trade-collection-delivery",
  "same-day-courier",
  "furniture-small-removals",
  "bulky-item-transport",
  "building-material-deliveries",
  "multi-drop-delivery",
]);

const ukPostcodePattern = /\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/gi;

export type TransportIntakeDecision = {
  isTransport: boolean;
  itemKnown: boolean;
  collectionPostcodeKnown: boolean;
  deliveryPostcodeKnown: boolean;
  accessKnown: boolean;
  handlingKnown: boolean;
  nextQuestionKey: "TRANSPORT_ROUTE_ITEM" | "TRANSPORT_ACCESS" | "TRANSPORT_HANDLING" | null;
  shouldAsk: boolean;
};

export type HyperlocalServiceIntakeDecision = {
  isHyperlocalService: boolean;
  serviceSlug: string | null;
  nextField: string | null;
  prompt: string | null;
  shouldAsk: boolean;
};

const genericHyperlocalFields = new Set([
  "postcode",
  "current_location",
  "required_date",
  "urgency",
  "preferred_time",
  "photos",
]);

function fieldIsKnown(field: string, evidence: string) {
  if (["recovery_destination", "collection_postcode", "delivery_postcode"].includes(field)) {
    const postcodes = new Set(Array.from(evidence.matchAll(ukPostcodePattern), (match) => (
      match[0].replace(/\s+/g, "").toUpperCase()
    )));
    return postcodes.size >= 2;
  }
  const patterns: Record<string, RegExp> = {
    vehicle_registration: /\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/i,
    make_model: /\b(?:make|model|ford|vauxhall|volkswagen|vw|audi|bmw|mercedes|toyota|nissan|kia|hyundai|renault|peugeot|citro[eë]n|skoda|seat)\b/i,
    driveable: /\b(?:driveable|drivable|not driveable|won['’]?t drive|cannot drive|can drive)\b/i,
    tyre_size: /\b\d{3}\/\d{2}\s?R\d{2}\b/i,
    property_type: /\b(?:house|flat|apartment|office|shop|warehouse|commercial|bungalow|detached|semi[- ]detached|terrace)\b/i,
    manufacturer: /\b(?:manufacturer|brand|bosch|beko|hotpoint|indesit|samsung|lg|aeg|miele|neff|siemens|whirlpool)\b/i,
    model: /\b(?:model|model number|rating plate)\b/i,
    error_code: /\b(?:error|code|[ef]\d{1,3})\b/i,
    recurrence: /\b(?:one[- ]off|weekly|fortnightly|monthly|regular)\b/i,
    quantity: /\b\d+\s*(?:items?|units?|tyres?|wheels?)\b/i,
    photos: /\[Customer (?:attachment|uploaded)\b/i,
    active_leak: /\b(?:leak(?:ing)?|burst|water (?:coming|pouring|dripping)|flood(?:ing|ed)?)\b/i,
    water_isolated: /\b(?:water (?:is )?(?:off|isolated)|stopcock|stop tap|cannot isolate|can['’]?t isolate)\b/i,
    active_overflow: /\b(?:overflow(?:ing)?|sewage|backing up|not overflowing)\b/i,
    heating_status: /\b(?:no heating|heating (?:is )?(?:working|on|off)|radiators? (?:are )?(?:hot|cold))\b/i,
    hot_water_status: /\b(?:no hot water|hot water (?:is )?(?:working|on|off)|water (?:is )?(?:hot|cold))\b/i,
    boiler_make_model: /\b(?:worcester|vaillant|ideal|baxi|viessmann|intergas|glow[- ]worm|alpha)(?:\s+[A-Z0-9-]+)?\b/i,
    appliance_type: /\b(?:washing machine|washer|tumble dryer|dryer|dishwasher|oven|cooker|fridge|freezer|hob|appliance)\b/i,
    integrated: /\b(?:integrated|built[- ]in|freestanding|free[- ]standing)\b/i,
    leaking: /\b(?:leak(?:ing)?|not leaking|dry underneath)\b/i,
    has_power: /\b(?:has power|power (?:is )?(?:on|off)|no power|lights? (?:are )?(?:on|off)|completely dead)\b/i,
    fuel_type: /\b(?:gas|electric|dual fuel|oil|lpg)\b/i,
    lock_type: /\b(?:euro cylinder|mortice|night latch|rim lock|multipoint|multi[- ]point|deadlock|padlock|smart lock|car lock)\b/i,
    door_type: /\b(?:front door|back door|patio door|french door|composite door|uPVC door|timber door|aluminium door|garage door|communal door|vehicle|car|van)\b/i,
    door_or_window_type: /\b(?:front door|back door|patio door|french door|composite door|uPVC door|timber door|aluminium door|window|vehicle|car|van)\b/i,
    authority_to_access: /\b(?:I (?:own|rent|occupy)|owner|tenant|landlord|authori[sz]ed|have permission|permission from)\b/i,
    dimensions: /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|ft|feet|inches?)?\s*(?:x|×|by)\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|ft|feet|inches?)?\b/i,
    floor_area: /\b\d+(?:\.\d+)?\s*(?:m2|m²|square metres?|sq\.?\s*(?:m|ft)|square feet)\b/i,
    garden_size: /\b(?:small|medium|large)(?:\s+\w+){0,2}\s+garden\b|\b\d+(?:\.\d+)?\s*(?:m2|m²|square metres?|sq\.?\s*(?:m|ft)|acres?)\b/i,
    bedrooms: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:bed|bedroom)s?\b/i,
    bathrooms: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:bath|bathroom)s?\b/i,
    preferred_time: /\b(?:morning|afternoon|evening|before \d|after \d|between \d|am|pm)\b/i,
    warning_lights: /\b(?:warning light|dashboard (?:light|message)|engine light|check engine|ABS|airbag|battery light|oil light)\b/i,
    damage_location: /\b(?:front|rear|back|side|left|right|near side|off side|bumper|door|wing|quarter|bonnet|boot|wheel|windscreen)\b/i,
    damage_type: /\b(?:dent(?:ed)?|scratch(?:ed)?|scuff(?:ed)?|crack(?:ed)?|chip(?:ped)?|broken|smashed|damage(?:d)?)\b/i,
    wheel_size: /\b(?:wheel|alloy)s?\s*(?:size)?\s*\d{2}|\b\d{2}\s*(?:inch|in|\")\s*(?:wheel|alloy)s?\b/i,
    blockage_location: /\b(?:sink|toilet|bath|shower|gully|manhole|outside drain|soil pipe|waste pipe)\b/i,
    boiler_type: /\b(?:combi|system boiler|heat[- ]only|regular boiler|gas boiler|oil boiler|electric boiler)\b/i,
    system_type: /\b(?:central heating|underfloor heating|radiator|thermostat|wet system|electric system)\b/i,
    cylinder_type: /\b(?:vented|unvented|direct|indirect|thermal store|hot water cylinder)\b/i,
    site_type: /\b(?:domestic|residential|commercial|industrial|office|shop|warehouse|school|hotel|restaurant|short[- ]let|airbnb)\b/i,
    area_or_length: /\b\d+(?:\.\d+)?\s*(?:m2|m²|square metres?|sq\.?\s*(?:m|ft)|metres?|feet|ft)\b/i,
    quantity_or_area: /\b\d+\s*(?:rooms?|windows?|ovens?|carpets?|sofas?|chairs?|items?)\b|\b\d+(?:\.\d+)?\s*(?:m2|m²|sq\.?\s*(?:m|ft))\b/i,
    waste_type: /\b(?:household|garden|green|builders?|construction|wood|timber|soil|rubble|furniture|office|mixed)\s+waste\b/i,
    waste_volume: /\b(?:\d+\s*(?:bags?|items?|rooms?)|car load|van load|skip load|room contents?|house contents?)\b/i,
    waste_removal: /\b(?:take|remove|clear|dispose|leave)\s+(?:the\s+)?(?:waste|rubbish|cuttings)|\bwaste removal\b/i,
    tree_count: /\b\d+\s*(?:trees?|hedges?)\b/i,
    approximate_height: /\b\d+(?:\.\d+)?\s*(?:m|metres?|ft|feet)\s*(?:high|tall)?\b/i,
    installation_or_repair: /\b(?:install(?:ation)?|fit(?:ting)?|new|repair|replace(?:ment)?|fix)\b/i,
    existing_system: /\b(?:existing|currently|already|old)\s+(?:fence|gate|patio|drive|deck|turf|lawn|system|surface)\b/i,
    existing_connections: /\b(?:existing|current)\s+(?:connection|supply|pipe|wiring|socket|drain|vent)\b/i,
    ground_condition: /\b(?:soil|clay|concrete|tarmac|gravel|grass|lawn|paving|sloped|level|uneven)\b/i,
    materials_by: /\b(?:supply (?:the )?materials?|materials? supplied|labour only|I have (?:the )?materials?)\b/i,
    completion_stage: /\b(?:installed|connected|fitted|commissioned|part[- ]finished|unfinished|complete)\b/i,
    doors_or_zones: /\b\d+\s*(?:doors?|windows?|zones?)\b/i,
    cameras_doors_zones: /\b\d+\s*(?:cameras?|doors?|zones?)\b/i,
    network_available: /\b(?:wi[- ]?fi|wired network|ethernet|no network|internet)\b/i,
    phone_availability: /\b(?:someone|I|tenant|occupier|reception)\s+(?:will be|is|am)\s+(?:there|available)|\bno one (?:will be|is) available\b/i,
  };
  const direct = patterns[field];
  if (direct?.test(evidence)) return true;
  if (["description", "symptoms", "fault", "fault_or_scope", "scope", "service_requested"].includes(field)) {
    return evidence.trim().split(/\s+/).length >= 4;
  }
  return new RegExp(`\\b${field.replaceAll("_", "[ -]?")}\\b`, "i").test(evidence);
}

const hyperlocalFieldQuestions: Record<string, string> = {
  vehicle_registration: "What is the vehicle registration?",
  make_model: "What is the vehicle make and model?",
  symptoms: "What is the vehicle doing, and are any warning lights showing?",
  warning_lights: "Which warning light or dashboard message can you see?",
  driveable: "Can the vehicle still be driven safely, or is it immobile?",
  tyre_size: "What tyre size is printed on the sidewall—for example 205/55 R16?",
  quantity: "How many items need attention?",
  damage_location: "Where on the vehicle is the damage?",
  damage_type: "Is it chipped, cracked or otherwise damaged?",
  wheel_size: "What wheel size is it, and how many wheels need work?",
  current_location: "What is the vehicle’s current postcode or precise location?",
  recovery_destination: "Where should the vehicle be recovered to? Please send the destination postcode.",
  service_requested: "What work would you like the specialist to carry out?",
  active_leak: "Is water still leaking now?",
  water_isolated: "Have you safely turned the water off, or is it still running?",
  property_type: "Is this a house, flat or commercial property?",
  blockage_location: "What is blocked—such as a sink, toilet or outside drain?",
  active_overflow: "Is it currently overflowing or backing up?",
  boiler_make_model: "What is the boiler make and model? A photo of the front and display is fine.",
  error_code: "Is there an error code or message on the display?",
  heating_status: "Do you have any heating at the moment?",
  hot_water_status: "Do you have any hot water at the moment?",
  boiler_type: "What type of boiler is it—combi, system or heat-only—and what fuel does it use?",
  bedrooms: "How many bedrooms does the property have?",
  bathrooms: "How many bathrooms does the property have?",
  system_type: "What type of system is involved?",
  fault_or_scope: "What is going wrong, or what work would you like done?",
  cylinder_type: "What type and approximate size of hot-water cylinder is it?",
  site_type: "What type of site or property is the work at?",
  scope: "What work should the supplier include in the quote?",
  access: "Is there anything suppliers need to know about access, stairs, parking or entry?",
  system_make_model: "What is the system make and model? A photo of the label is fine.",
  description: "Please describe the problem or work needed in one sentence.",
  recurrence: "Is this a one-off job or do you need a regular service?",
  floor_area: "What is the approximate floor area to be covered?",
  quantity_or_area: "Roughly how many items or what area needs cleaning?",
  area_or_length: "What approximate area or length needs work?",
  waste_type: "What type of waste or items need clearing?",
  waste_volume: "Roughly how much is there—for example bags, a van load or room contents?",
  garden_size: "Roughly how large is the garden or outdoor area?",
  area: "What approximate area needs work?",
  waste_removal: "Should the quote include taking the garden waste away?",
  tree_count: "How many trees need work?",
  approximate_height: "Roughly how tall are they? A photo from a safe distance is useful.",
  installation_or_repair: "Is this a new installation or a repair to something existing?",
  dimensions: "What are the approximate width and height? A photo with measurements is ideal.",
  existing_system: "What existing system or surface is already there?",
  existing_connections: "Are the required power, water, drainage or ventilation connections already in place?",
  ground_condition: "What is the current ground or base like?",
  materials_by: "Should the supplier provide the materials, or will you supply them?",
  appliance_type: "Which appliance needs attention?",
  manufacturer: "What is the appliance brand and model number? A photo of the rating plate is perfect.",
  model: "What is the appliance brand and model number? A photo of the rating plate is perfect.",
  fault: "What is the appliance doing—or not doing?",
  integrated: "Is the appliance integrated/built-in or freestanding?",
  leaking: "Is it currently leaking?",
  has_power: "Does the appliance have power or show any lights?",
  fuel_type: "Is it gas, electric or dual fuel?",
  completion_stage: "Is the appliance installed already, and has the fitting been completed?",
  lock_type: "What type of lock is it, if you know? A clear photo is fine.",
  door_type: "What are you locked out of—for example a front door, commercial door or vehicle?",
  door_or_window_type: "Is this for a door, window, vehicle or something else?",
  authority_to_access: "Are you the owner, occupier or otherwise authorised to access the property or vehicle?",
  doors_or_zones: "How many doors, windows or alarm zones need work?",
  cameras_doors_zones: "How many cameras, doors or alarm zones should the quote cover?",
  network_available: "Is Wi-Fi or a wired network available where the system will be installed?",
  phone_availability: "Will someone with the entry phone be available during the visit?",
  collection_postcode: "What is the collection postcode?",
  delivery_postcode: "What is the delivery postcode?",
};

function questionForHyperlocalField(field: string) {
  return hyperlocalFieldQuestions[field] ?? `What ${field.replaceAll("_", " ")} should the specialist allow for?`;
}

function fieldAnsweredAfterQuestion(field: string, messages: IntakeConversationMessage[]) {
  const question = questionForHyperlocalField(field).toLocaleLowerCase("en-GB");
  const questionIndex = messages.findLastIndex((message) => (
    message.direction === "OUTBOUND"
    && message.text.toLocaleLowerCase("en-GB").includes(question)
  ));
  return questionIndex >= 0 && messages.slice(questionIndex + 1).some((message) => (
    message.direction === "INBOUND" && message.text.trim().length > 0
  ));
}

function questionAlreadyAsked(field: string, messages: IntakeConversationMessage[]) {
  const question = questionForHyperlocalField(field).toLocaleLowerCase("en-GB");
  return messages.some((message) => (
    message.direction === "OUTBOUND"
    && message.text.toLocaleLowerCase("en-GB").includes(question)
  ));
}

export function hyperlocalServiceIntakeDecision(
  draft: TradeDraft,
  messages: IntakeConversationMessage[],
): HyperlocalServiceIntakeDecision {
  const entry = hyperlocalService(draft.categorySlug);
  if (!entry) return { isHyperlocalService: false, serviceSlug: null, nextField: null, prompt: null, shouldAsk: false };

  const inbound = messages.filter((message) => message.direction === "INBOUND").map((message) => message.text).join("\n");
  const evidence = [
    inbound,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join("\n");
  const missing = entry.service.requiredInformation
    .filter((field) => !genericHyperlocalFields.has(field))
    .filter((field) => !fieldIsKnown(field, evidence))
    .filter((field) => !questionAlreadyAsked(field, messages) || !fieldAnsweredAfterQuestion(field, messages));
  const hasAttachment = /\[Customer (?:attachment|uploaded)\b/i.test(inbound);
  const nextField = (missing.includes("authority_to_access") ? "authority_to_access" : missing[0]) ?? null;
  const detailRequest = nextField ? questionForHyperlocalField(nextField) : null;
  const photoAlreadyRequested = Boolean(entry.service.photoPrompt && messages.some((message) => (
    message.direction === "OUTBOUND" && message.text.includes(entry.service.photoPrompt!)
  )));
  const photoRequest = !detailRequest && !hasAttachment && !photoAlreadyRequested && entry.service.photoPrompt
    ? `${entry.service.photoPrompt} If you cannot send one, just say NO PHOTO and I’ll continue from your description.`
    : null;
  const hasEarlierServiceQuestion = messages.some((message) => message.direction === "OUTBOUND"
    && Object.values(hyperlocalFieldQuestions).some((question) => message.text.includes(question)));
  const prompt = detailRequest
    ? `${hasEarlierServiceQuestion ? "Thanks —" : "I can help with that."} ${detailRequest}`
    : photoRequest;
  return {
    isHyperlocalService: true,
    serviceSlug: entry.service.slug,
    nextField,
    prompt: detailRequest || photoRequest ? prompt : null,
    shouldAsk: Boolean(detailRequest || photoRequest),
  };
}

function hasAnswerAfterPrompt(messages: IntakeConversationMessage[], promptPattern: RegExp) {
  const promptIndex = messages.findLastIndex((message) => (
    message.direction === "OUTBOUND" && promptPattern.test(message.text)
  ));
  return promptIndex >= 0 && messages.slice(promptIndex + 1).some((message) => (
    message.direction === "INBOUND" && message.text.trim().length > 0
  ));
}

export function transportIntakeDecision(
  draft: TradeDraft & { deliveryPostcode?: string | null },
  messages: IntakeConversationMessage[],
): TransportIntakeDecision {
  const isTransport = Boolean(draft.categorySlug && transportCategorySlugs.has(draft.categorySlug));
  if (!isTransport) {
    return {
      isTransport: false,
      itemKnown: false,
      collectionPostcodeKnown: false,
      deliveryPostcodeKnown: false,
      accessKnown: false,
      handlingKnown: false,
      nextQuestionKey: null,
      shouldAsk: false,
    };
  }
  const inbound = messages
    .filter((message) => message.direction === "INBOUND")
    .map((message) => message.text)
    .join("\n");
  const evidence = [
    inbound,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join("\n");
  const postcodes = new Set(Array.from(evidence.matchAll(ukPostcodePattern), (match) => match[0].replace(/\s+/g, "").toUpperCase()));
  const itemKnown = draft.items.length > 0
    && draft.items.some((item) => item.description.trim().length > 1);
  const collectionPostcodeKnown = postcodes.size >= 2
    || /\b(?:collection|collect(?:ion)?\s+from|pick[- ]?up)\b[^\n]{0,80}\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/i.test(evidence);
  const deliveryPostcodeKnown = Boolean(draft.deliveryPostcode) || postcodes.size >= 2;
  const accessKnown = /\b(?:ground[- ]?floor|first[- ]?floor|second[- ]?floor|upper[- ]?floor|stairs?|steps?|lift|elevator|level access|no stairs|access at both|access restrictions?)\b/i.test(inbound)
    || hasAnswerAfterPrompt(messages, /ground floor at both addresses|stairs or a lift at either end/i);
  const handlingKnown = /\b(?:driver (?:to )?help|help (?:to )?(?:carry|load|unload)|carry(?:ing)? help|loading help|unloading help|load it|unload it|two[- ]person|two man|extra crew|additional crew|someone (?:will )?help|help at both ends|no help (?:needed|required))\b/i.test(inbound)
    || hasAnswerAfterPrompt(messages, /driver to help carry or load|someone help at both ends/i);
  const nextQuestionKey = !itemKnown || !collectionPostcodeKnown || !deliveryPostcodeKnown
    ? "TRANSPORT_ROUTE_ITEM"
    : !accessKnown
      ? "TRANSPORT_ACCESS"
      : !handlingKnown
        ? "TRANSPORT_HANDLING"
        : null;
  return {
    isTransport,
    itemKnown,
    collectionPostcodeKnown,
    deliveryPostcodeKnown,
    accessKnown,
    handlingKnown,
    nextQuestionKey,
    shouldAsk: nextQuestionKey !== null,
  };
}

export function transportIntakePrompt(input: TransportIntakeDecision) {
  if (input.nextQuestionKey === "TRANSPORT_ROUTE_ITEM") {
    if (input.itemKnown) {
      return "Please send the full collection and delivery postcodes. A photo of the item is helpful too, especially for furniture or anything bulky.";
    }
    return "Please send a photo or short description of what is moving, plus the full collection and delivery postcodes.";
  }
  if (input.nextQuestionKey === "TRANSPORT_ACCESS") {
    return "Is it ground floor at both addresses, or are there stairs or a lift at either end?";
  }
  if (input.nextQuestionKey === "TRANSPORT_HANDLING") {
    return "Will you need the driver to help carry or load it, or will someone help at both ends?";
  }
  return null;
}

const pheSpecificationEvidence: Record<string, RegExp> = {
  "boilers-heating-packages": /\b(?:gas|oil|electric|hybrid|combi|system|regular|heat only|\d+(?:\.\d+)?\s*kW|flue|boiler schedule)\b/i,
  "heat-pumps": /\b(?:air[- ]source|ground[- ]source|monobloc|split|hybrid|heat loss|\d+(?:\.\d+)?\s*kW|flow temperature|single[- ]phase|three[- ]phase)\b/i,
  "cylinders-hot-water-storage": /\b(?:vented|unvented|direct|indirect|twin[- ]coil|thermal store|buffer|\d+(?:\.\d+)?\s*(?:l|litres?))\b/i,
  "underfloor-heating": /\b(?:wet|electric|overlay|screed|low[- ]profile|\d+(?:\.\d+)?\s*m(?:2|²)|zones?|pipe centres?)\b/i,
  "radiators-heat-emitters": /\b(?:type\s*[123]|panel|designer|towel rail|trench|fan convector|\d+\s*(?:w|watts?|btu)|\d+\s*x\s*\d+\s*mm)\b/i,
  "pipework-fittings": /\b(?:copper|pex|mlcp|plastic|carbon steel|stainless|\d+(?:\.\d+)?\s*mm|\bDN\s*\d+|pipe schedule)\b/i,
  "valves-heating-controls": /\b(?:isolation|balancing|mixing|zone|trv|thermostat|actuator|\bDN\s*\d+|\d+(?:\.\d+)?\s*mm)\b/i,
  "pumps-pressurisation": /\b(?:flow|head|duty|circulator|booster|pressurisation|expansion vessel|condensate|m3\/h|m³\/h|l\/s|kpa|bar)\b/i,
  "mechanical-plant-packages": /\b(?:schematic|schedule|drawing|specification|boq|bill of quantities|plantroom|packaged|skid)\b/i,
};

export type PheSpecificationDecision = {
  isPhe: boolean;
  categorySlug: string | null;
  hasAttachment: boolean;
  hasPricingSpecification: boolean;
  alreadyAsked: boolean;
  shouldAsk: boolean;
};

export function pheSpecificationPrompt(categorySlug: string | null) {
  const prompts: Record<string, string> = {
    "boilers-heating-packages": "For an accurate plumbing, heating or mechanical quote, what boiler type or fuel, output (kW) and package items do you need? A schedule or specification is welcome.",
    "heat-pumps": "For an accurate plumbing, heating or mechanical quote, is this air-source, ground-source or hybrid, and what design heat loss or output (kW) is required? Please send the heat-loss calculation or schedule if you have it.",
    "cylinders-hot-water-storage": "For an accurate plumbing, heating or mechanical quote, what cylinder or vessel type, capacity in litres and coil arrangement do you need? A schedule is welcome.",
    "underfloor-heating": "For an accurate plumbing, heating or mechanical quote, what floor area, number of zones and floor build-up should suppliers price? You can send a drawing or schedule instead.",
    "radiators-heat-emitters": "For an accurate plumbing, heating or mechanical quote, please send the radiator or emitter sizes and outputs, or upload the schedule.",
    "pipework-fittings": "For an accurate plumbing, heating or mechanical quote, what pipe material or system, sizes and quantities do you need? A take-off or schedule is ideal.",
    "valves-heating-controls": "For an accurate plumbing, heating or mechanical quote, what valve or control types, sizes and quantities do you need? A schedule is welcome.",
    "pumps-pressurisation": "For an accurate plumbing, heating or mechanical quote, what pump or unit type and duty information (such as flow and head) should suppliers price? A schedule is welcome.",
    "mechanical-plant-packages": "For an accurate plumbing, heating or mechanical quote, please send the plant schedule, schematic or bill of quantities, or briefly list the main equipment required.",
  };
  return prompts[categorySlug ?? ""]
    ?? "For an accurate plumbing, heating or mechanical quote, which product or package do you need? A schedule, schematic, heat-loss calculation, drawing or PDF is welcome.";
}

export function pheSpecificationDecision(draft: TradeDraft, messages: IntakeConversationMessage[]): PheSpecificationDecision {
  const categorySlug = draft.categorySlug;
  const isPhe = Boolean(categorySlug && pheCategorySlugs.has(categorySlug));
  const evidence = [
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
    ...messages.filter((message) => message.direction === "INBOUND").map((message) => message.text),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const hasAttachment = messages.some((message) => message.direction === "INBOUND" && /^\[Customer (?:attachment|uploaded)\b/i.test(message.text));
  const alreadyAsked = messages.some((message) => message.direction === "OUTBOUND" && message.text.includes("For an accurate plumbing, heating or mechanical quote"));
  const hasPricingSpecification = Boolean(categorySlug && pheSpecificationEvidence[categorySlug]?.test(evidence));
  return {
    isPhe,
    categorySlug,
    hasAttachment,
    hasPricingSpecification,
    alreadyAsked,
    shouldAsk: isPhe && !hasAttachment && !hasPricingSpecification && !alreadyAsked,
  };
}

export function roofGlazingSpecificationDecision(draft: TradeDraft, messages: IntakeConversationMessage[]): RoofGlazingSpecificationDecision {
  const inboundEvidence = messages
    .filter((message) => message.direction === "INBOUND")
    .map((message) => message.text);
  const evidence = [
    ...inboundEvidence,
    draft.categorySlug,
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const isRoofGlazing = /\b(?:roof[-\s]*glass|roof[-\s]*glazing|flat[-\s]*roof[-\s]*glass|roof[-\s]*lights?|rooflights?|roof[-\s]*lanterns?|stepped?[-\s]*(?:glass[-\s]*)?units?)\b/i.test(evidence);
  const dimensionPair = "\\d+(?:\\.\\d+)?\\s*(?:mm|cm|m)?\\s*(?:x|×|by)\\s*\\d+(?:\\.\\d+)?\\s*(?:mm|cm|m)?";
  const internalSizesKnown = new RegExp(`(?:internal|inside|structural[-\\s]*opening|kerb[-\\s]*opening|upstand[-\\s]*opening)(?:[-\\s]*(?:size|sizes|dimensions?))?[^\\n]{0,50}${dimensionPair}|${dimensionPair}[^\\n]{0,35}(?:internal|inside|structural[-\\s]*opening|kerb[-\\s]*opening|upstand[-\\s]*opening)`, "i").test(evidence);
  const materialKnown = /\b(?:uPVC|PVCu|aluminium|aluminum|timber|wood|frameless|glass[-\s]*only|no frame)\b/i.test(evidence);
  const latestColour = latestColourMention(evidence);
  const colourKnown = isRecognisedIndustryColour(latestColour)
    || /\b(?:RAL\s*[-:]?\s*\d{4}|BS\s*[-:]?\s*\d{3,4}|manufacturer(?:'s)?\s+(?:colour|finish|code|name)|no colour|colour not applicable|frameless|glass[-\s]*only|no frame)\b/i.test(evidence);
  const decision = {
    isRoofGlazing,
    internalSizesNeeded: isRoofGlazing && !internalSizesKnown,
    materialNeeded: isRoofGlazing && !materialKnown,
    colourNeeded: isRoofGlazing && !colourKnown,
    shouldAsk: false,
  };
  decision.shouldAsk = decision.internalSizesNeeded || decision.materialNeeded || decision.colourNeeded;
  return decision;
}

function latestColourMention(value: string) {
  return Array.from(value.matchAll(new RegExp(colourMentionPattern.source, "gi"))).at(-1)?.[0] ?? null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function quoteDraftFingerprint(draft: unknown) {
  return createHash("sha256").update(canonicalJson(draft)).digest("hex");
}

export function conversationProgress(input: {
  previousFingerprint: string | null;
  previousQuestionKey: string | null;
  previousUnproductiveTurns: number;
  currentFingerprint: string;
  currentQuestionKey: IntakeQuestionKey;
}) {
  const progressed = input.previousFingerprint !== input.currentFingerprint;
  const repeatedQuestion = input.currentQuestionKey !== "NONE"
    && input.previousQuestionKey === input.currentQuestionKey;
  const unproductiveTurns = !progressed && repeatedQuestion
    ? Math.min(MAX_UNPRODUCTIVE_TURNS, input.previousUnproductiveTurns + 1)
    : 0;
  return {
    progressed,
    repeatedQuestion,
    unproductiveTurns,
    needsHumanReview: unproductiveTurns >= MAX_UNPRODUCTIVE_TURNS,
  };
}

export function requiredQuestionKey(
  draft: {
    buyerType?: "CONSUMER" | "TRADE" | "BUSINESS" | null;
    deliveryPostcode: string | null;
    categorySlug: string | null;
    title: string | null;
    summary: string | null;
    requiredBy: string | null;
    fulfilmentMode: "SERVICE" | "INSTALLATION" | "SUPPLY_ONLY" | "DELIVERY" | "COLLECTION" | null;
    items: unknown[];
  },
  proposed: IntakeQuestionKey,
  tradeClarification: TradeClarification = {
    materialNeeded: false,
    colourNeeded: false,
    colourTerm: null,
  },
): IntakeQuestionKey {
  if (!draft.categorySlug) return "PRODUCT";
  if (industryRootCategorySlugs.has(draft.categorySlug)) return "PRODUCT";
  if (!draft.items.length) return "PRODUCT";
  if (!draft.deliveryPostcode) return "DELIVERY_POSTCODE";
  if (!draft.requiredBy) return "REQUIRED_BY";
  if (!draft.fulfilmentMode) return "FULFILMENT";
  if (draft.buyerType === null) return "BUYER_TYPE";
  if (tradeClarification.materialNeeded || tradeClarification.colourNeeded) return "SPECIFICATION";
  if (!draft.title || !draft.summary) return "REQUIREMENTS";
  return proposed;
}

function safeClarificationTerm(value: string | null | undefined) {
  return value?.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || null;
}

export function enforceTradeClarification(
  draft: TradeDraft,
  proposed: TradeClarification,
  customerMessages: string[],
): TradeClarification {
  if (draft.categorySlug && (pheCategorySlugs.has(draft.categorySlug) || transportCategorySlugs.has(draft.categorySlug) || hyperlocalService(draft.categorySlug))) {
    return { materialNeeded: false, colourNeeded: false, colourTerm: null };
  }
  const evidence = [
    ...customerMessages.slice(-12),
    draft.title,
    draft.summary,
    ...draft.items.flatMap((item) => [item.description, item.specification]),
  ].filter((value): value is string => Boolean(value)).join(" ");
  const materialKnown = /\b(?:uPVC|PVCu|aluminium|aluminum|timber|wood|composite|frameless|glass[-\s]*only|no frame)\b/i.test(evidence);
  const broadMaterialCategory = draft.categorySlug === "windows" || draft.categorySlug === "doors";
  const oliveMentioned = /\bolive(?:\s+green)?\b/i.test(evidence);
  const industryColourResolved = /\b(?:RAL\s*[-:]?\s*\d{4}|BS\s*[-:]?\s*\d{3,4}|(?:closest|nearest)(?:\s+available)?(?:\s+olive)?\s+(?:match|finish|shade|colour)|manufacturer(?:'s)?\s+(?:colour|finish|code|name)|(?:colour|finish)\s+code)\b/i.test(evidence);
  const colourTerm = proposed.colourTerm ?? latestColourMention(evidence) ?? (oliveMentioned ? "olive" : null);
  const recognisedIndustryColour = isRecognisedIndustryColour(colourTerm);
  return {
    materialNeeded: materialKnown ? false : proposed.materialNeeded || broadMaterialCategory,
    colourNeeded: recognisedIndustryColour || industryColourResolved
      ? false
      : proposed.colourNeeded || (oliveMentioned && !industryColourResolved),
    colourTerm,
  };
}

export function tradeSpecificationClarification(input: TradeClarification, productDescription?: string | null) {
  const product = safeClarificationTerm(productDescription)?.toLowerCase() || "product";
  const colour = safeClarificationTerm(input.colourTerm);
  if (input.materialNeeded && input.colourNeeded) {
    return `For the ${product}, what material should suppliers price, and for “${colour ?? "that colour"}” do you have a RAL or manufacturer colour reference—or should they offer their closest available match?`;
  }
  if (input.materialNeeded) {
    return `What material should suppliers price for the ${product}—for example uPVC, aluminium or timber?`;
  }
  if (input.colourNeeded) {
    return `When you say “${colour ?? "that colour"}”, do you have a RAL or manufacturer colour reference—or should suppliers offer their closest available match?`;
  }
  return null;
}

export function universalRequestPrompt() {
  return [
    "What do you need? Bridge it.",
    "Send me a message, photo, drawing or document. Tell me where you need it and when you need it.",
    "If you know the quantity, specification and whether you need delivery, collection or on-site work, include those too.",
  ].join("\n\n");
}

export function productSelectionPrompt() {
  return [
    "What exactly do you need, and roughly how many?",
    "Describe it in your own words or send a clear photo, survey, drawing, schedule or PDF. I’ll identify the right specialist suppliers behind the scenes.",
  ].join("\n\n");
}

export function repeatClarification(questionKey: IntakeQuestionKey) {
  const prompts: Record<Exclude<IntakeQuestionKey, "NONE">, string> = {
    BUYER_TYPE: "Is this for you personally, for your trade work or client, or for another business? Reply PERSONAL, TRADE or BUSINESS.",
    PRODUCT: productSelectionPrompt(),
    DELIVERY_POSTCODE: "What is the full UK delivery postcode? For example, GL52 6TD.",
    REQUIRED_BY: "When do you need it? Give me a date or a clear deadline, such as Friday or within seven days.",
    FULFILMENT: "How do you need it — delivery, collection, supply only, or work carried out on site?",
    CATEGORY: "Which product is this for — for example uPVC windows, aluminium bifolds, a composite door or a roof lantern?",
    COMPOSITE_STYLE: compositeDoorStylePhotoPrompt(),
    ROOF_GLAZING_SPECIFICATION: "What are the internal opening size, frame/material and colour or finish for the roof glazing? Please label the measurements as INTERNAL.",
    PHE_SPECIFICATION: pheSpecificationPrompt(null),
    TRANSPORT_ROUTE_ITEM: "Please send a photo or short description of what is moving, plus the full collection and delivery postcodes.",
    TRANSPORT_ACCESS: "Is it ground floor at both addresses, or are there stairs or a lift at either end?",
    TRANSPORT_HANDLING: "Will you need the driver to help carry or load it, or will someone help at both ends?",
    HYPERLOCAL_SERVICE: "Please answer the short service-specific question above so I can match the right local specialist.",
    SPECIFICATION: "What important detail should suppliers price — for example size, material, colour or opening style?",
    REQUIREMENTS: "What would you like the supplier to include in this quote?",
  };
  return questionKey === "NONE" ? null : prompts[questionKey];
}

export function conversationalRecoveryPrompt(questionKey: IntakeQuestionKey) {
  const prompts: Record<Exclude<IntakeQuestionKey, "NONE">, string> = {
    BUYER_TYPE: "Just so I match the right businesses: is this for you personally, for your trade work, or for another business?",
    PRODUCT: "Tell me the item or job in a few words, or send a photo, drawing or PDF. I’ll work out the right specialist category for you.",
    DELIVERY_POSTCODE: "I’m ready to help. Send the full postcode for where this is needed—for example GL52 6TD.",
    REQUIRED_BY: "What deadline should I work to? You can say today, tomorrow, Friday, within seven days, or give me a date.",
    FULFILMENT: "Should suppliers price delivery, collection, supply only, or work carried out on site?",
    CATEGORY: "Tell me the exact product or job in your own words and I’ll put it in the right category.",
    COMPOSITE_STYLE: "A photo or brochure screenshot of the composite-door style would help. If you do not have one, describe the style and I’ll continue.",
    ROOF_GLAZING_SPECIFICATION: "For the roof glazing, send the INTERNAL opening size, frame material and colour. If one is unknown, say which one.",
    PHE_SPECIFICATION: "Send the model, schedule, drawing or main heating specification you have. If you are unsure, tell me what the system needs to do.",
    TRANSPORT_ROUTE_ITEM: "What needs moving, from which full postcode to which full postcode? A photo is welcome.",
    TRANSPORT_ACCESS: "What is access like at collection and delivery—ground floor, stairs or lift?",
    TRANSPORT_HANDLING: "Will the driver need to help carry or load, or is help available at both ends?",
    HYPERLOCAL_SERVICE: "Describe the problem or work needed in one sentence, and send a photo if it helps.",
    SPECIFICATION: "Which size, material, colour, system or opening detail should suppliers price? Tell me what you know and I’ll work with it.",
    REQUIREMENTS: "What should the supplier include in the price? A short description is enough.",
  };
  return questionKey === "NONE" ? null : prompts[questionKey];
}
