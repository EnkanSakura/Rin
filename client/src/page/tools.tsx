import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { useSiteConfig } from "../hooks/useSiteConfig";

type ToolItem = {
  id: string;
  titleKey: string;
  descKey: string;
  icon: string;
  href: string;
};

const TOOLS: ToolItem[] = [
  {
    id: "color-picker",
    titleKey: "tools.color_picker.title",
    descKey: "tools.color_picker.desc",
    icon: "ri-palette-line",
    href: "/tools/color-picker",
  },
  {
    id: "base64",
    titleKey: "tools.base64.title",
    descKey: "tools.base64.desc",
    icon: "ri-file-code-line",
    href: "/tools/base64",
  },
  {
    id: "json-formatter",
    titleKey: "tools.json_formatter.title",
    descKey: "tools.json_formatter.desc",
    icon: "ri-braces-line",
    href: "/tools/json-formatter",
  },
  {
    id: "qr-code",
    titleKey: "tools.qr_code.title",
    descKey: "tools.qr_code.desc",
    icon: "ri-qr-code-line",
    href: "/tools/qr-code",
  },
  {
    id: "markdown",
    titleKey: "tools.markdown.title",
    descKey: "tools.markdown.desc",
    icon: "ri-markdown-line",
    href: "/tools/markdown",
  },
  {
    id: "password",
    titleKey: "tools.password.title",
    descKey: "tools.password.desc",
    icon: "ri-lock-line",
    href: "/tools/password",
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
            <a
              key={tool.id}
              href={tool.href}
              className="group flex items-center gap-4 rounded-2xl border border-black/10 bg-w p-5 transition-all hover:border-theme/30 hover:shadow-md dark:border-white/10"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-theme/10 text-xl text-theme transition-transform group-hover:scale-110">
                <i className={tool.icon} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold t-primary group-hover:text-theme transition-colors">
                  {t(tool.titleKey)}
                </h3>
                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400 line-clamp-1">
                  {t(tool.descKey)}
                </p>
              </div>
              <i className="ri-arrow-right-s-line text-lg text-neutral-300 transition-colors group-hover:text-theme dark:text-neutral-600" />
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
