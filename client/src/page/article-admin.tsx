import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { useLocation } from "wouter";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { useAlert, useConfirm } from "../components/dialog";
import { ToolbarButton } from "../components/toolbar-button";
import { useSiteConfig } from "../hooks/useSiteConfig";

const PAGE_SIZE = 20;

interface FeedRow {
    id: number;
    title: string | null;
    alias: string | null;
    draft: number;
    listed: number;
    top: number;
    createdAt: string;
    updatedAt: string;
    summary?: string;
}

function asRows(data: unknown): FeedRow[] {
    if (!data || typeof data !== "object" || !Array.isArray((data as { data?: unknown }).data)) {
        return [];
    }
    const rows = (data as { data: unknown[] }).data;
    const result: FeedRow[] = [];
    for (const raw of rows) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Record<string, unknown>;
        const id = Number(row.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        result.push({
            id,
            title: typeof row.title === "string" && row.title ? row.title : null,
            alias: typeof row.alias === "string" ? row.alias : null,
            draft: Number(row.draft) === 1 ? 1 : 0,
            listed: row.listed === undefined || row.listed === null ? 1 : Number(row.listed) === 1 ? 1 : 0,
            top: Number(row.top) === 1 ? 1 : 0,
            createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
            updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
            summary: typeof row.summary === "string" ? row.summary : undefined,
        });
    }
    return result;
}

function formatDateTime(value: string): string {
    const locale = (typeof window !== "undefined" && window.navigator.language) || "zh-CN";
    const resolved = locale.startsWith("zh") ? "zh-CN" : locale.startsWith("ja") ? "ja-JP" : "en-US";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(resolved, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// The writing view (and its Markdown editor) is heavy, so it is loaded
// lazily. Entering the backend never blocks on it: the chunk is prefetched
// in the background as soon as this page mounts, and by the time the user
// opens "写作" the resources are usually already available.
const WritingEditor = lazy(() =>
    import("./writing").then((module) => ({ default: module.WritingPage })),
);

// ============================================================================
// 文章管理 (Article management): searchable feed list with batch operations,
// plus the original markdown writing editor behind the "写作" button.
// ============================================================================

export function ArticleAdminPage({
    initialWrite = false,
    initialId = 0,
}: {
    initialWrite?: boolean;
    initialId?: number;
}) {
    const { t } = useTranslation();
    const siteConfig = useSiteConfig();
    const [location, setLocation] = useLocation();

    const [writeMode, setWriteMode] = useState(initialWrite);
    const [editId, setEditId] = useState<number | undefined>(
        initialId ? Number(initialId) : undefined,
    );

    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [rows, setRows] = useState<FeedRow[]>([]);
    const [size, setSize] = useState(0);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
    const [busy, setBusy] = useState(false);

    const { showAlert, AlertUI } = useAlert();
    const { showConfirm, ConfirmUI } = useConfirm();

    // Prefetch the writing/editor chunks right away so that opening the
    // editor later never blocks the page.
    useEffect(() => {
        void import("./writing");
        void import("../components/markdown_editor");
    }, []);

    const fetchRows = useCallback((kw: string, pageNo: number) => {
        setLoading(true);
        setError(null);
        const trimmed = kw.trim();
        const request = trimmed
            ? client.search.search(trimmed, { page: pageNo, limit: PAGE_SIZE })
            : client.feed.list({ type: "all", page: pageNo, limit: PAGE_SIZE });

        request.then(({ data, error: loadError }) => {
            if (loadError) {
                setError(loadError.value);
                return;
            }
            setRows(asRows(data));
            setSize(data?.size ?? 0);
            setHasNext(Boolean(data?.hasNext));
        }).finally(() => setLoading(false));
    }, []);

    // Debounced refetch when the keyword or page changes.
    useEffect(() => {
        const handle = window.setTimeout(() => {
            fetchRows(keyword, page);
        }, 200);
        return () => window.clearTimeout(handle);
    }, [keyword, page, fetchRows]);

    const isSearching = keyword.trim().length > 0;
    const selectedCount = selected.size;
    const visibleSelectedRows = useMemo(
        () => rows.filter((row) => selected.has(row.id)),
        [rows, selected],
    );

    function goWrite(id?: number) {
        setEditId(id);
        setWriteMode(true);
        setSelected(new Set());
    }

    function goPage(nextPage: number) {
        setPage(nextPage);
        setSelected(new Set());
    }

    /** Publishing/updating stays on the article management page: leave the
        editor and refresh the list right below. When opened through a legacy
        /admin/writing URL, normalize the location back to the list page. */
    function handleEditorSaved() {
        if (location !== "/admin/articles") {
            setLocation("/admin/articles");
            return;
        }
        setWriteMode(false);
        setEditId(undefined);
        setPage(1);
        fetchRows(keyword, 1);
    }

    function toggleSelected(id: number) {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    // ── Batch actions ─────────────────────────────────────────────────────

    function batchDelete() {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        const reload = () => {
            setSelected(new Set());
            if (rows.length - ids.length <= 0 && page > 1) {
                goPage(page - 1);
            } else {
                fetchRows(keyword, page);
            }
        };
        showConfirm(
            t("article_admin.delete_confirm_title"),
            t("article_admin.delete_confirm_desc$count", { count: ids.length }),
            async () => {
                setBusy(true);
                let done = 0;
                let firstError: string | null = null;
                for (const id of ids) {
                    const { error: deleteError } = await client.feed.delete(id);
                    if (deleteError) {
                        firstError = firstError ?? deleteError.value;
                    } else {
                        done += 1;
                    }
                }
                setBusy(false);
                if (firstError) {
                    showAlert(t("delete.failed$message", { message: firstError }), reload);
                } else {
                    showAlert(t("article_admin.delete_done$count", { count: done }), reload);
                }
            },
        );
    }

    /** Shared runner for batch flag updates (publish / draft / show / hide). */
    function runFlagUpdates(opts: {
        rows: FeedRow[];
        apply: (row: FeedRow) => { draft: boolean; listed: boolean };
        confirmTitle: string;
        confirmDescription: string;
        doneMessage: string;
    }) {
        showConfirm(
            opts.confirmTitle,
            opts.confirmDescription,
            async () => {
                setBusy(true);
                let done = 0;
                let firstError: string | null = null;
                for (const row of opts.rows) {
                    const { error: saveError } = await client.feed.update(row.id, opts.apply(row));
                    if (saveError) {
                        firstError = firstError ?? saveError.value;
                    } else {
                        done += 1;
                    }
                }
                setBusy(false);
                const reload = () => {
                    setSelected(new Set());
                    fetchRows(keyword, page);
                };
                if (firstError) {
                    showAlert(t("update.failed$message", { message: firstError }), reload);
                } else {
                    showAlert(opts.doneMessage, reload);
                }
            },
        );
    }

    // 发布：草稿文章转为所有人可见。
    function batchPublish() {
        const drafts = visibleSelectedRows.filter((row) => row.draft === 1);
        if (drafts.length === 0) {
            showAlert(t("article_admin.nothing_to_publish"));
            return;
        }
        runFlagUpdates({
            rows: drafts,
            apply: (row) => ({ draft: false, listed: row.listed === 1 }),
            confirmTitle: t("article_admin.publish_confirm_title"),
            confirmDescription: t("article_admin.publish_confirm_desc$count", { count: drafts.length }),
            doneMessage: t("article_admin.publish_done$count", { count: drafts.length }),
        });
    }

    // 草稿：已发布（可见）文章转回草稿。
    function batchToDraft() {
        const published = visibleSelectedRows.filter((row) => row.draft === 0);
        if (published.length === 0) {
            showAlert(t("article_admin.nothing_to_draft"));
            return;
        }
        runFlagUpdates({
            rows: published,
            apply: (row) => ({ draft: true, listed: row.listed === 1 }),
            confirmTitle: t("article_admin.draft_confirm_title"),
            confirmDescription: t("article_admin.draft_confirm_desc$count", { count: published.length }),
            doneMessage: t("article_admin.draft_done$count", { count: published.length }),
        });
    }

    // 显示：让未列出的已发布文章重新出现在文章页。
    function batchShow() {
        const hiddenPublished = visibleSelectedRows.filter(
            (row) => row.draft === 0 && row.listed === 0,
        );
        if (hiddenPublished.length === 0) {
            showAlert(t("article_admin.nothing_to_show"));
            return;
        }
        runFlagUpdates({
            rows: hiddenPublished,
            apply: () => ({ draft: false, listed: true }),
            confirmTitle: t("article_admin.show_confirm_title"),
            confirmDescription: t("article_admin.show_confirm_desc$count", { count: hiddenPublished.length }),
            doneMessage: t("article_admin.show_done$count", { count: hiddenPublished.length }),
        });
    }

    // 隐藏：把正在显示的文章从文章页（feed 页）隐藏，链接仍可访问。
    function batchHide() {
        const listedPublished = visibleSelectedRows.filter(
            (row) => row.draft === 0 && row.listed === 1,
        );
        if (listedPublished.length === 0) {
            showAlert(t("article_admin.nothing_to_hide"));
            return;
        }
        runFlagUpdates({
            rows: listedPublished,
            apply: () => ({ draft: false, listed: false }),
            confirmTitle: t("article_admin.hide_confirm_title"),
            confirmDescription: t("article_admin.hide_confirm_desc$count", { count: listedPublished.length }),
            doneMessage: t("article_admin.hide_done$count", { count: listedPublished.length }),
        });
    }

    const batchDisabled = selectedCount === 0 || busy;

    if (writeMode) {
        return (
            <div className="flex w-full flex-col gap-4">
                <Helmet>
                    <title>{`${t("writing")} - ${siteConfig.name}`}</title>
                </Helmet>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-w px-4 py-3 dark:border-white/10">
                    <div className="flex items-center gap-3">
                        <Button
                            secondary
                            title={t("article_admin.back_to_list")}
                            onClick={() => {
                                setWriteMode(false);
                                setEditId(undefined);
                            }}
                        />
                        <p className="text-sm font-medium t-primary">
                            {editId === undefined
                                ? t("article_admin.new_article")
                                : t("article_admin.edit_article$id", { id: editId })}
                        </p>
                    </div>
                    {editId !== undefined ? (
                        <a
                            href={`/feed/${editId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-theme dark:text-neutral-400"
                        >
                            <i className="ri-external-link-line text-sm" aria-hidden="true" />
                            {t("article_admin.view")}
                        </a>
                    ) : null}
                </div>
                <Suspense
                    fallback={
                        <div className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-black/10 bg-w py-24 dark:border-white/10">
                            <ReactLoading width="1.5em" height="1.5em" type="spin" color="#FC466B" />
                        </div>
                    }
                >
                    <WritingEditor id={editId} onSaved={handleEditorSaved} />
                </Suspense>
                <AlertUI />
                <ConfirmUI />
            </div>
        );
    }

    return (
        <div className="flex w-full flex-col gap-4">
            <Helmet>
                <title>{`${t("article_admin.title")} - ${siteConfig.name}`}</title>
            </Helmet>

            <AlertUI />
            <ConfirmUI />

            {/* ── Toolbar ─────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-black/10 bg-w px-4 py-3 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Search */}
                    <div className="relative min-w-0 flex-1 sm:max-w-sm">
                        <i
                            className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-neutral-400"
                            aria-hidden="true"
                        />
                        <input
                            type="search"
                            value={keyword}
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                                setSelected(new Set());
                            }}
                            placeholder={t("article_admin.search_placeholder")}
                            className="w-full rounded-full border border-black/10 bg-secondary/60 py-2 pl-10 pr-9 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-theme/40 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:bg-white/5"
                        />
                        {keyword ? (
                            <button
                                type="button"
                                onClick={() => setKeyword("")}
                                aria-label={t("clear")}
                                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                            >
                                <i className="ri-close-line text-sm" aria-hidden="true" />
                            </button>
                        ) : null}
                    </div>

                    <div className="ml-auto flex flex-wrap items-center gap-2">
                        {busy ? (
                            <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
                        ) : null}

                        {selectedCount > 0 ? (
                            <span className="hidden items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500 sm:flex dark:bg-white/10 dark:text-neutral-300">
                                {t("article_admin.selected_count$count", { count: selectedCount })}
                            </span>
                        ) : null}

                        <ToolbarButton title={t("article_admin.make_visible")} onClick={batchPublish} disabled={batchDisabled} />
                        <ToolbarButton title={t("article_admin.make_draft")} onClick={batchToDraft} disabled={batchDisabled} />
                        <ToolbarButton title={t("article_admin.show")} onClick={batchShow} disabled={batchDisabled} />
                        <ToolbarButton title={t("article_admin.hide")} onClick={batchHide} disabled={batchDisabled} />
                        <ToolbarButton title={t("delete.title")} onClick={batchDelete} danger disabled={batchDisabled} />
                        <span className="mx-1 hidden h-5 w-px bg-black/10 sm:block dark:bg-white/10" aria-hidden="true" />
                        <Button title={t("writing")} onClick={() => goWrite(undefined)} />
                    </div>
                </div>
            </div>

            {/* ── List ────────────────────────────────────────────────── */}
            {error ? (
                <div className="rounded-2xl border border-black/10 bg-w px-4 py-8 text-center text-sm text-red-500 dark:border-white/10">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <div className="flex items-center justify-center gap-3 py-10 text-sm text-neutral-500 dark:text-neutral-400">
                    <ReactLoading width="1.25em" height="1.25em" type="spin" color="#FC466B" />
                    <span>{t("article_admin.loading")}</span>
                </div>
            ) : null}

            {!loading && !error && rows.length === 0 ? (
                <div className="rounded-2xl border border-black/10 bg-w px-4 py-12 text-center dark:border-white/10">
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        {isSearching ? t("article_admin.empty_search") : t("article_admin.empty")}
                    </p>
                </div>
            ) : null}

            {!loading && !error && rows.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-black/10 bg-w dark:border-white/10">
                    {rows.map((row, index) => {
                        const checked = selected.has(row.id);
                        return (
                            <div
                                key={row.id}
                                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                                    index > 0 ? "border-t border-black/5 dark:border-white/5" : ""
                                } hover:bg-black/[0.02] dark:hover:bg-white/[0.03]`}
                            >
                                <label className="flex shrink-0 cursor-pointer items-center">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleSelected(row.id)}
                                        className="h-4 w-4 accent-theme"
                                        aria-label={row.title || t("untitled")}
                                    />
                                </label>

                                <button
                                    type="button"
                                    onClick={() => goWrite(row.id)}
                                    className="group flex min-w-0 flex-1 items-center gap-3 text-left"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                            <span className="truncate text-sm font-medium t-primary transition-colors group-hover:text-theme">
                                                {row.title || t("untitled")}
                                            </span>
                                            {row.draft === 1 ? (
                                                <span className="rounded-full border border-amber-300/50 bg-amber-50 px-2 py-0.5 text-xs text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                                                    {t("draft")}
                                                </span>
                                            ) : row.listed !== 1 ? (
                                                <span className="rounded-full border border-black/10 bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/10 dark:text-neutral-400">
                                                    {t("unlisted")}
                                                </span>
                                            ) : null}
                                            {row.top === 1 ? (
                                                <span className="text-theme">
                                                    <i className="ri-pushpin-2-line" aria-hidden="true" />
                                                </span>
                                            ) : null}
                                        </p>
                                        <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                                            <span className="whitespace-nowrap">
                                                {formatDateTime(row.createdAt)}
                                            </span>
                                            {row.summary ? (
                                                <>
                                                    <span aria-hidden="true">·</span>
                                                    <span className="min-w-0 truncate">{row.summary}</span>
                                                </>
                                            ) : null}
                                        </p>
                                    </div>
                                </button>

                                <div className="flex shrink-0 items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => goWrite(row.id)}
                                        title={t("article_admin.edit")}
                                        className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                                    >
                                        <i className="ri-pencil-line text-sm" aria-hidden="true" />
                                    </button>
                                    <a
                                        href={`/feed/${row.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={t("article_admin.view")}
                                        className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                                    >
                                        <i className="ri-external-link-line text-sm" aria-hidden="true" />
                                    </a>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {/* ── Pagination ──────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {t("article.total$count", { count: size })}
                </p>
                <div className="flex items-center gap-2">
                    {page > 1 ? (
                        <ToolbarButton title={t("previous")} onClick={() => goPage(page - 1)} />
                    ) : null}
                    {hasNext ? (
                        <ToolbarButton title={t("next")} onClick={() => goPage(page + 1)} />
                    ) : null}
                </div>
            </div>
        </div>
    );
}
