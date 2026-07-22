import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { Markdown } from "../components/markdown";

export function AboutPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();

  return (
    <div className="flex w-full flex-col items-center py-8">
      <Helmet>
        <title>{`${t("about.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      {siteConfig.aboutContent ? (
        <div className="w-full max-w-3xl">
          <h1 className="mb-8 text-2xl font-bold t-primary">{t("about.title")}</h1>
          <div className="rounded-2xl border border-black/10 bg-w px-6 py-8 dark:border-white/10">
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Markdown content={siteConfig.aboutContent} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-16">
          <i className="ri-information-line text-4xl text-neutral-400" />
          <p className="text-neutral-500 dark:text-neutral-400">
            {t("about.notfound")}
          </p>
        </div>
      )}
    </div>
  );
}
