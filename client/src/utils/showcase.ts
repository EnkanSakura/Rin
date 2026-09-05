// Shared helpers for the showcase (展柜) feature.
import type { ShowcaseGroupWithItems, ShowcaseItem } from "@rin/api";

/** Defensive parse of the public showcase API payload. */
export function parseShowcaseData(data: { showcases?: unknown } | undefined | null): ShowcaseGroupWithItems[] {
  const raw = Array.isArray(data?.showcases) ? data.showcases : [];
  return raw.filter((group): group is ShowcaseGroupWithItems => {
    if (!group || typeof group !== "object") return false;
    const candidate = group as ShowcaseGroupWithItems;
    return typeof candidate.id === "number" && typeof candidate.name === "string";
  });
}

/** Defensive read of an item list that may be missing or malformed. */
export function filterShowcaseItems(items: ShowcaseItem[] | undefined | null): ShowcaseItem[] {
  return Array.isArray(items) ? items : [];
}

/** First image of an item, used as the card cover ("" when absent). */
export function showcaseCoverOf(item: ShowcaseItem): string {
  return (item.images ?? [])[0] ?? "";
}
