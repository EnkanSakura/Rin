import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { Markdown } from "../components/markdown";

// Navigation card data
const NAV_ITEMS = [
  {
    href: "/feeds",
    icon: "ri-article-line",
    key: "articles",
  },
  {
    href: "/timeline",
    icon: "ri-timeline-view",
    key: "timeline",
  },
  {
    href: "/moments",
    icon: "ri-magic-line",
    key: "moments",
  },
  {
    href: "/friends",
    icon: "ri-user-heart-line",
    key: "friends",
  },
  {
    href: "/hashtags",
    icon: "ri-hashtag",
    key: "hashtags",
  },
] as const;

export function HomePage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();

  return (
    <div className="flex flex-col items-center">
      <Helmet>
        <title>{siteConfig.name}</title>
      </Helmet>

      {/* Hero Section — full viewport */}
      <section className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-center">
        {siteConfig.avatar && (
          <img
            src={siteConfig.avatar}
            alt={siteConfig.name}
            className="mb-8 h-28 w-28 rounded-full border-2 border-black/10 object-cover dark:border-white/10 md:h-36 md:w-36"
          />
        )}
        <h1 className="mb-3 text-4xl font-bold t-primary md:text-5xl">{siteConfig.name}</h1>
        {siteConfig.description && (
          <p className="mb-8 max-w-lg text-center text-base text-neutral-500 dark:text-neutral-400">
            {siteConfig.description}
          </p>
        )}
        {/* External Links */}
        {siteConfig.externalLinks.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {siteConfig.externalLinks.map((link, index) => (
              <a
                key={index}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 rounded-xl border border-black/10 px-4 py-2 text-sm t-primary transition-all hover:border-black/20 hover:bg-black/5 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/5"
              >
                {link.icon && <i className={`${link.icon} text-base`} />}
                <span>{link.name}</span>
                <i className="ri-external-link-line text-xs text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ))}
          </div>
        )}

        {/* Scroll-down hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-neutral-400">
          <i className="ri-arrow-down-s-line text-2xl" />
        </div>
      </section>

      {/* Navigation Section */}
      <section className="w-full max-w-3xl pb-12">
        <h2 className="mb-6 text-center text-lg font-semibold t-primary">
          {t("home.navigation")}
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-black/10 bg-w p-6 text-center transition-all hover:border-theme/30 hover:shadow-md hover:shadow-theme/5 dark:border-white/10 dark:hover:border-theme/30"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-theme/10 text-xl text-theme">
                <i className={item.icon} />
              </div>
              <div>
                <h3 className="text-sm font-medium t-primary">
                  {t(`home.nav.${item.key}.title`)}
                </h3>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {t(`home.nav.${item.key}.desc`)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* About Section */}
      {siteConfig.aboutContent && (
        <section className="w-full max-w-3xl pb-16">
          <h2 className="mb-6 text-center text-lg font-semibold t-primary">
            {t("about.title")}
          </h2>
          <div className="rounded-2xl border border-black/10 bg-w px-6 py-8 dark:border-white/10">
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Markdown content={siteConfig.aboutContent} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
