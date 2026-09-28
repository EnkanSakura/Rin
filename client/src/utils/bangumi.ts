// Helpers shared by the bangumi page and its admin settings.

/** Column counts offered in the admin settings (default is 4). */
export const BANGUMI_COLUMN_OPTIONS = [2, 3, 4, 5, 6] as const;

export const BANGUMI_DEFAULT_COLUMNS = 4;

/**
 * Static Tailwind classes per column count. Tailwind only emits classes it can
 * see in the source, so the responsive track definitions must stay literal.
 */
const GRID_COLUMN_CLASSES: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-6",
};

/** Normalize the `bangumi.columns` config value, falling back to 4. */
export function resolveBangumiColumns(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return BANGUMI_DEFAULT_COLUMNS;
  }
  const rounded = Math.round(parsed);
  return GRID_COLUMN_CLASSES[rounded] ? rounded : BANGUMI_DEFAULT_COLUMNS;
}

/** Responsive grid classes for the configured column count. */
export function bangumiGridClass(value: unknown): string {
  return GRID_COLUMN_CLASSES[resolveBangumiColumns(value)];
}

/**
 * Cover requests go through the site API (`/api/bangumi/cover`) instead of
 * hitting `lain.bgm.tv` directly, so the grid renders for visitors whose
 * network cannot reach Bangumi.
 */
export function bangumiCoverSrc(src?: string | null): string | undefined {
  const value = src?.trim();
  if (!value) {
    return undefined;
  }
  return `/api/bangumi/cover?src=${encodeURIComponent(value)}`;
}

/** Best available cover URL from a collection entry. */
export function bangumiCoverSource(images?: {
  large?: string;
  common?: string;
  medium?: string;
} | null): string | undefined {
  return images?.large || images?.common || images?.medium || undefined;
}
