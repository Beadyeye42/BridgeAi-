import { HYPERLOCAL_INDUSTRIES } from "@/lib/categories/hyperlocal-industries";

export type IndustryExperience = {
  supplierExperience: string;
  whatsappExperience: string;
  launchReady: boolean;
};

const industryExperiences: Record<string, IndustryExperience> = {
  windows: {
    supplierExperience: "Windows, doors and glazing capability controls",
    whatsappExperience: "Opening style, material, colour, sizes and drawing-led questions",
    launchReady: true,
  },
  "plumbing-heating-mechanical": {
    supplierExperience: "PHE manufacturers, systems, capacity and lead-time controls",
    whatsappExperience: "Product-specific mechanical questions with schedule, schematic and heat-loss support",
    launchReady: true,
  },
  "transport-delivery-removals": {
    supplierExperience: "Vehicle, crew, handling, route-capacity and availability controls",
    whatsappExperience: "Collection, destination, date, load, access and handling questions",
    launchReady: true,
  },
  "bespoke-metal-fabrication": {
    supplierExperience: "Fabricator capability and engineering-responsibility controls required",
    whatsappExperience: "Drawing, grade, finish, fixing and deadline intake still being prepared",
    launchReady: false,
  },
  "garage-industrial-specialist-doors": {
    supplierExperience: "Door-system, certification and survey controls required",
    whatsappExperience: "Product-specific access, survey and certification intake still being prepared",
    launchReady: false,
  },
};

for (const industry of HYPERLOCAL_INDUSTRIES) {
  industryExperiences[industry.slug] = {
    supplierExperience: `${industry.name} service, availability, audience and verification controls`,
    whatsappExperience: "Automatic service recognition with progressive, service-specific qualification",
    launchReady: true,
  };
}

export function industryExperience(slug: string): IndustryExperience {
  return industryExperiences[slug] ?? {
    supplierExperience: "Specialist supplier controls have not been built yet",
    whatsappExperience: "Industry-specific WhatsApp questions have not been built yet",
    launchReady: false,
  };
}

export function industryLaunchBlocker(slug: string, activeProductCount: number) {
  if (activeProductCount < 1) return "Add and enable at least one product before launching this industry.";
  if (!industryExperience(slug).launchReady) {
    return "Build and test this industry's supplier screen, WhatsApp questions and matching rules before launch.";
  }
  return null;
}
