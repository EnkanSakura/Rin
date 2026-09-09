import type { ReactNode } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useSiteConfig } from "../../hooks/useSiteConfig";

/**
 * Shared chrome for the individual tool pages: document title, breadcrumb back
 * to the tool hub and a consistent card surface.
 */
export function ToolShell({
  titleKey,
  descriptionKey,
  icon,
  children,
}: {
  titleKey: string;
  descriptionKey: string;
  icon: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const title = t(titleKey);

  return (
    <>
      <Helmet>
        <title>{`${title} - ${siteConfig.name}`}</title>
      </Helmet>
      <main className="w-full flex flex-col justify-center items-center mb-8 ani-show">
        <div className="wauto text-start py-4">
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-sm text-neutral-500 transition-colors hover:text-theme dark:text-neutral-400"
          >
            <i className="ri-arrow-left-s-line text-lg" aria-hidden="true" />
            {t("tools.back")}
          </Link>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-theme/10 text-xl text-theme">
              <i className={icon} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold t-primary">{title}</h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{t(descriptionKey)}</p>
            </div>
          </div>
        </div>

        <div className="wauto">{children}</div>
      </main>
    </>
  );
}

export function ToolCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-black/10 bg-w p-5 dark:border-white/10 ${className}`}
    >
      {children}
    </section>
  );
}

export function ToolField({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm ${className}`}>
      <span className="font-medium t-primary">{label}</span>
      {children}
      {hint ? <span className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</span> : null}
    </label>
  );
}

export function ToolError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
      <i className="ri-error-warning-line mt-0.5 shrink-0" aria-hidden="true" />
      <span className="break-all">{message}</span>
    </div>
  );
}
