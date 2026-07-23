import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { ClientConfigContext } from "../../../state/config";

interface NavItemDef {
  labelKey: string;
  href: string;
  matchPrefix?: string;
}

const NAV_ITEM_MAP: Record<string, NavItemDef> = {
  feeds: { labelKey: "article.title", href: "/feeds", matchPrefix: "/feed" },
  timeline: { labelKey: "timeline", href: "/timeline" },
  moments: { labelKey: "moments.title", href: "/moments" },
  hashtags: { labelKey: "hashtags", href: "/hashtags" },
  tools: { labelKey: "tools.title", href: "/tools" },
  friends: { labelKey: "friends.title", href: "/friends" },
  bangumi: { labelKey: "bangumi.title", href: "/bangumi" },
  about: { labelKey: "about.title", href: "/about" },
};

export function NavBar({
  menu,
  onClick,
  itemClassName = "",
}: {
  menu: boolean;
  onClick?: () => void;
  itemClassName?: string;
}) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const clientConfig = useContext(ClientConfigContext);

  const navLinksRaw = String(clientConfig.get("nav.links") ?? "[]");
  let enabledIds: string[];
  try {
    enabledIds = JSON.parse(navLinksRaw);
    if (!Array.isArray(enabledIds)) enabledIds = [];
  } catch {
    enabledIds = [];
  }

  return (
    <>
      {enabledIds.map((id) => {
        const def = NAV_ITEM_MAP[id];
        if (!def) return null;
        const selected = def.matchPrefix
          ? location.startsWith(def.matchPrefix) || location.startsWith(def.href)
          : location === def.href;
        return (
          <NavItem
            key={id}
            menu={menu}
            onClick={onClick}
            itemClassName={itemClassName}
            title={t(def.labelKey)}
            selected={selected}
            href={def.href}
          />
        );
      })}
    </>
  );
}

function NavItem({
  menu,
  title,
  selected,
  href,
  when = true,
  onClick,
  itemClassName = "",
}: {
  title: string;
  selected: boolean;
  href: string;
  menu?: boolean;
  when?: boolean;
  onClick?: () => void;
  itemClassName?: string;
}) {
  return when ? (
    <Link
      href={href}
      className={`${menu ? "" : "hidden"} md:block cursor-pointer hover:text-theme duration-300 px-2 py-4 md:p-4 text-sm ${
        selected ? "text-theme" : "dark:text-white"
      } ${itemClassName}`}
      state={{ animate: true }}
      onClick={onClick}
    >
      {title}
    </Link>
  ) : null;
}
