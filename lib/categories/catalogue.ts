export const launchCategoryRootId = "category_windows";

const legacyCategoryAliases: Record<string, string> = {
  doors: "windows",
  "upvc-doors": "upvc-windows",
  "aluminium-doors": "aluminium-windows",
  "bifold-doors": "aluminium-windows",
  "timber-doors": "timber-windows",
  "conservatories-extensions": "conservatories",
  roofing: "roof-lanterns",
};

export function normalizeLaunchCategorySlug(slug: string | null) {
  if (!slug) return null;
  return legacyCategoryAliases[slug] ?? slug;
}
