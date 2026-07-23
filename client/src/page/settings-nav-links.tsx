import { useTranslation } from "react-i18next";
import { ItemDraggableChecklist, type ChecklistOption } from "./settings-items";

/** All first-level navigable route pages (labelKey maps to i18n key) */
const NAV_ITEM_DEFS = [
  { id: "feeds", labelKey: "article.title" },
  { id: "timeline", labelKey: "timeline" },
  { id: "moments", labelKey: "moments.title" },
  { id: "hashtags", labelKey: "hashtags" },
  { id: "tools", labelKey: "tools.title" },
  { id: "friends", labelKey: "friends.title" },
  { id: "bangumi", labelKey: "bangumi.title" },
  { id: "about", labelKey: "about.title" },
] as const;

export function NavLinksSettings({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  const options: ChecklistOption[] = NAV_ITEM_DEFS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
  }));

  return (
    <ItemDraggableChecklist
      title={t("settings.nav_links.title")}
      description={t("settings.nav_links.desc")}
      allOptions={options}
      value={value}
      onChange={onChange}
    />
  );
}
