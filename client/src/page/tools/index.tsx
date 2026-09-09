import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useSiteConfig } from "../../hooks/useSiteConfig";

type ToolItem = {
  id: string;
  titleKey: string;
  descKey: string;
  icon: string;
  href: string;
};

const TOOLS: ToolItem[] = [
  {
    id: "x-downloader",
    titleKey: "tools.x_downloader.title",
    descKey: "tools.x_downloader.desc",
    icon: "ri-twitter-x-line",
    href: "/tools/x-downloader",
  },
  {
    id: "lc-calculator",
    titleKey: "tools.lc_calculator.title",
    descKey: "tools.lc_calculator.desc",
    icon: "ri-equalizer-2-line",
    href: "/tools/lc-calculator",
  },
  {
    id: "comic-downloader",
    titleKey: "tools.comic_downloader.title",
    descKey: "tools.comic_downloader.desc",
    icon: "ri-book-2-line",
    href: "/tools/comic-downloader",
  },
];

export function ToolsPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();

  return (
    <>
      <Helmet>
        <title>{`${t("tools.title")} - ${siteConfig.name}`}</title>
      </Helmet>
      <main className="w-full flex flex-col justify-center items-center mb-8 ani-show">
        <div className="wauto text-start py-4 text-4xl font-bold">
          <p className="text-black dark:text-white">
            {t("tools.title")}
          </p>
          <div className="flex flex-row justify-between">
            <p className="text-sm mt-4 text-neutral-500 font-normal">
              {t("tools.description")}
            </p>
          </div>
        </div>

        <div className="wauto grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <Link
              key={tool.id}
              href={tool.href}
              className="group flex items-center gap-4 rounded-2xl border border-black/10 bg-w p-5 transition-all hover:border-theme/30 hover:shadow-md dark:border-white/10"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-theme/10 text-xl text-theme transition-transform group-hover:scale-110">
                <i className={tool.icon} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold t-primary group-hover:text-theme transition-colors">
                  {t(tool.titleKey)}
                </h3>
                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400 line-clamp-1">
                  {t(tool.descKey)}
                </p>
              </div>
              <i className="ri-arrow-right-s-line text-lg text-neutral-300 transition-colors group-hover:text-theme dark:text-neutral-600" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
