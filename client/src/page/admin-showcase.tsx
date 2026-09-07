import {
  FlatActionButton,
  Modal,
  SearchableSelect,
} from "@rin/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { useAlert, useConfirm } from "../components/dialog";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Input } from "../components/input";
import { ToolbarButton } from "../components/toolbar-button";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { filterShowcaseItems, parseShowcaseData } from "../utils/showcase";
import {
  DEFAULT_IMAGE_MAX_FILE_SIZE,
  isImageFile,
  uploadImageFile,
} from "../utils/image-upload";
import type { ShowcaseGroupWithItems, ShowcaseItem } from "@rin/api";

type GroupDraft = {
  id: number | null;
  name: string;
};

type ItemDraft = {
  id: number | null;
  showcaseId: number;
  title: string;
  images: string[];
  desc: string;
};

// ============================================================================
// Toolbar shared by the group list and the entry list (mirrors 文章管理)
// ============================================================================

function ListToolbar({
  keyword,
  onKeywordChange,
  placeholder,
  selectedCount,
  busy,
  onDelete,
  deleteTitle,
  onCreate,
  createTitle,
  onBack,
  backTitle,
  contextLabel,
}: {
  keyword: string;
  onKeywordChange: (value: string) => void;
  placeholder: string;
  selectedCount: number;
  busy: boolean;
  onDelete: () => void;
  deleteTitle: string;
  onCreate: () => void;
  createTitle: string;
  onBack?: () => void;
  backTitle?: string;
  contextLabel?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-black/10 bg-w px-4 py-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-3">
        {onBack ? (
          <>
            <button
              type="button"
              onClick={onBack}
              title={backTitle}
              aria-label={backTitle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
            >
              <i className="ri-arrow-left-line text-lg" aria-hidden="true" />
            </button>
            {contextLabel ? (
              <span className="max-w-40 truncate text-sm font-medium t-primary">{contextLabel}</span>
            ) : null}
          </>
        ) : null}

        {/* Search */}
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <i
            className="ri-search-line pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-neutral-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder={placeholder}
            className="w-full rounded-full border border-black/10 bg-secondary/60 py-2 pl-10 pr-9 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-theme/40 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:bg-white/5"
          />
          {keyword ? (
            <button
              type="button"
              onClick={() => onKeywordChange("")}
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
              {t("showcase.admin.selected_count$count", { count: selectedCount })}
            </span>
          ) : null}

          <ToolbarButton title={deleteTitle} onClick={onDelete} danger disabled={selectedCount === 0 || busy} />
          <span className="mx-1 hidden h-5 w-px bg-black/10 sm:block dark:bg-white/10" aria-hidden="true" />
          <Button title={createTitle} onClick={onCreate} disabled={busy} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Admin Showcase management page (展柜管理)
// ============================================================================

export function AdminShowcasePage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();

  // null = showcase list; otherwise the id of the showcase whose entries are shown
  const [viewGroupId, setViewGroupId] = useState<number | null>(null);
  const [groups, setGroups] = useState<ShowcaseGroupWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  const [groupModal, setGroupModal] = useState<GroupDraft | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [itemModal, setItemModal] = useState<ItemDraft | null>(null);
  const [itemSaving, setItemSaving] = useState(false);

  const { showAlert, AlertUI } = useAlert();
  const { showConfirm, ConfirmUI } = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    client.showcase
      .list()
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError(loadError.value);
          return;
        }
        const parsed = parseShowcaseData(data);
        setGroups(parsed);
        setViewGroupId((current) => {
          if (current !== null && parsed.some((group) => group.id === current)) return current;
          return null;
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const viewGroup = useMemo(() => {
    const group = groups.find((candidate) => candidate.id === viewGroupId);
    return group ?? null;
  }, [groups, viewGroupId]);

  const keywordLower = keyword.trim().toLowerCase();

  // Searchable rows for the current view
  const visibleGroups = useMemo(
    () =>
      groups.filter((group) =>
        keywordLower ? group.name.toLowerCase().includes(keywordLower) : true,
      ),
    [groups, keywordLower],
  );

  const viewItems = useMemo(() => {
    const items = viewGroup ? filterShowcaseItems(viewGroup.items) : [];
    if (!keywordLower) return items;
    return items.filter((item) =>
      `${item.title} ${item.desc}`
        .toLowerCase()
        .includes(keywordLower),
    );
  }, [viewGroup, keywordLower]);

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

  function enterGroup(groupId: number) {
    setViewGroupId(groupId);
    setKeyword("");
    setSelected(new Set());
  }

  function backToGroups() {
    setViewGroupId(null);
    setKeyword("");
    setSelected(new Set());
  }

  // ── Group CRUD & ordering ───────────────────────────────────────────────

  function openCreateGroup() {
    setGroupModal({ id: null, name: "" });
  }

  function openRenameGroup(group: ShowcaseGroupWithItems) {
    setGroupModal({ id: group.id, name: group.name });
  }

  function saveGroup() {
    if (!groupModal) return;
    const name = groupModal.name.trim();
    if (!name) {
      showAlert(t("showcase.admin.group_name_required"));
      return;
    }
    setGroupSaving(true);
    const request = groupModal.id === null
      ? client.showcase.createGroup({ name })
      : client.showcase.updateGroup(groupModal.id, { name });

    request
      .then(({ error: saveError }) => {
        if (saveError) {
          showAlert(saveError.value);
          return;
        }
        showAlert(t("showcase.admin.group_save_success"));
        setGroupModal(null);
        load();
      })
      .finally(() => setGroupSaving(false));
  }

  function batchDeleteGroups() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const reload = () => {
      setSelected(new Set());
      setBusy(false);
      load();
    };
    showConfirm(
      t("showcase.admin.group_delete_batch_title"),
      t("showcase.admin.group_delete_batch_description", { count: ids.length }),
      async () => {
        setBusy(true);
        let done = 0;
        let firstError: string | null = null;
        for (const id of ids) {
          const { error: deleteError } = await client.showcase.deleteGroup(id);
          if (deleteError) {
            firstError = firstError ?? deleteError.value;
          } else {
            done += 1;
          }
        }
        setBusy(false);
        if (firstError) {
          showAlert(firstError, reload);
        } else {
          showAlert(t("showcase.admin.group_delete_batch_done", { count: done }), reload);
        }
      },
    );
  }

  function persistGroupOrder(ordered: ShowcaseGroupWithItems[]) {
    setGroups(ordered);
    setReorderSaving(true);
    client.showcase
      .reorderGroups({ ids: ordered.map((group) => group.id) })
      .then(({ error: saveError }) => {
        if (saveError) {
          showAlert(saveError.value);
          load();
        }
      })
      .finally(() => setReorderSaving(false));
  }

  function moveGroup(groupId: number, delta: -1 | 1) {
    const index = groups.findIndex((group) => group.id === groupId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= groups.length) return;
    const next = [...groups];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persistGroupOrder(next);
  }

  // ── Item CRUD & ordering ────────────────────────────────────────────────

  function openCreateItem() {
    if (!viewGroup) return;
    setItemModal({
      id: null,
      showcaseId: viewGroup.id,
      title: "",
      images: [],
      desc: "",
    });
  }

  function openEditItem(item: ShowcaseItem) {
    setItemModal({
      id: item.id,
      showcaseId: item.showcaseId,
      title: item.title,
      images: item.images ?? [],
      desc: item.desc,
    });
  }

  function saveItem() {
    if (!itemModal) return;
    const title = itemModal.title.trim();
    const desc = itemModal.desc.trim();
    const images = itemModal.images
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    setItemSaving(true);
    const payload = { title, images, desc };

    const request = itemModal.id === null
      ? client.showcase.createItem(itemModal.showcaseId, payload)
      : client.showcase.updateItem(itemModal.id, {
          ...payload,
          showcaseId: itemModal.showcaseId,
        });

    request
      .then(({ error: saveError }) => {
        if (saveError) {
          showAlert(saveError.value);
          return;
        }
        showAlert(t("showcase.admin.item_save_success"));
        setItemModal(null);
        load();
      })
      .finally(() => setItemSaving(false));
  }

  function batchDeleteItems() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const reload = () => {
      setSelected(new Set());
      setBusy(false);
      load();
    };
    showConfirm(
      t("showcase.admin.item_delete_batch_title"),
      t("showcase.admin.item_delete_batch_description", { count: ids.length }),
      async () => {
        setBusy(true);
        let done = 0;
        let firstError: string | null = null;
        for (const id of ids) {
          const { error: deleteError } = await client.showcase.deleteItem(id);
          if (deleteError) {
            firstError = firstError ?? deleteError.value;
          } else {
            done += 1;
          }
        }
        setBusy(false);
        if (firstError) {
          showAlert(firstError, reload);
        } else {
          showAlert(t("showcase.admin.item_delete_batch_done", { count: done }), reload);
        }
      },
    );
  }

  function persistItemOrder(groupId: number, orderedItems: ShowcaseItem[]) {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, items: orderedItems } : group,
      ),
    );
    setReorderSaving(true);
    client.showcase
      .reorderItems({ ids: orderedItems.map((item) => item.id) })
      .then(({ error: saveError }) => {
        if (saveError) {
          showAlert(saveError.value);
          load();
        }
      })
      .finally(() => setReorderSaving(false));
  }

  function moveItem(groupId: number, itemId: number, delta: -1 | 1) {
    const group = groups.find((candidate) => candidate.id === groupId);
    const fullItems = group ? filterShowcaseItems(group.items) : [];
    const index = fullItems.findIndex((item) => item.id === itemId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= fullItems.length) return;
    const next = [...fullItems];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persistItemOrder(groupId, next);
  }

  function changeKeyword(value: string) {
    setKeyword(value);
    setSelected(new Set());
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <Helmet>
        <title>{`${t("showcase.admin.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      <AlertUI />
      <ConfirmUI />

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-10 text-sm text-neutral-500 dark:text-neutral-400">
          <ReactLoading width="1.25em" height="1.25em" type="spin" color="#FC466B" />
          <span>{t("showcase.admin.loading")}</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-black/10 bg-w px-4 py-8 text-center text-sm text-red-500 dark:border-white/10">
          {error}
        </div>
      ) : null}

      {!loading && !error && viewGroup === null && (
        <GroupManager
          groups={visibleGroups}
          hasSearch={keyword.trim().length > 0}
          keyword={keyword}
          onKeywordChange={changeKeyword}
          selected={selected}
          onToggleSelected={toggleSelected}
          reorderSaving={reorderSaving}
          busy={busy}
          onCreate={openCreateGroup}
          onDeleteSelected={batchDeleteGroups}
          onEnter={(group) => enterGroup(group.id)}
          onRename={openRenameGroup}
          onMoveUp={(group) => moveGroup(group.id, -1)}
          onMoveDown={(group) => moveGroup(group.id, 1)}
        />
      )}

      {!loading && !error && viewGroup !== null && (
        <ItemManager
          group={viewGroup}
          items={viewItems}
          hasSearch={keyword.trim().length > 0}
          keyword={keyword}
          onKeywordChange={changeKeyword}
          selected={selected}
          onToggleSelected={toggleSelected}
          reorderSaving={reorderSaving}
          busy={busy}
          onBack={backToGroups}
          onCreate={openCreateItem}
          onDeleteSelected={batchDeleteItems}
          onEdit={openEditItem}
          onMoveUp={(item) => moveItem(viewGroup.id, item.id, -1)}
          onMoveDown={(item) => moveItem(viewGroup.id, item.id, 1)}
        />
      )}

      {/* Group create / rename modal */}
      <Modal
        isOpen={groupModal !== null}
        onRequestClose={() => setGroupModal(null)}
        contentLabel={groupModal?.id === null ? t("showcase.admin.group_add") : t("showcase.admin.group_edit")}
        size="sm"
        panelClassName="p-6"
      >
        <div className="flex w-full flex-col items-start">
          <h2 className="text-xl font-bold tracking-[-0.02em] t-primary">
            {groupModal?.id === null ? t("showcase.admin.group_add") : t("showcase.admin.group_edit")}
          </h2>
          <label className="mt-4 text-sm font-medium t-primary">{t("showcase.admin.group_name")}</label>
          <Input
            value={groupModal?.name ?? ""}
            setValue={(value) => setGroupModal((current) => (current ? { ...current, name: value } : current))}
            placeholder={t("showcase.admin.group_name_placeholder")}
            variant="flat"
            className="mt-2"
          />
          <div className="mt-6 flex w-full flex-row justify-end gap-3">
            <FlatActionButton onClick={() => setGroupModal(null)} className="text-neutral-500 dark:text-neutral-400">
              {t("cancel")}
            </FlatActionButton>
            <FlatActionButton onClick={saveGroup} className="t-primary" disabled={groupSaving}>
              {groupSaving ? t("saving") : t("save")}
            </FlatActionButton>
          </div>
        </div>
      </Modal>

      {/* Item create / edit modal */}
      {itemModal ? (
        <ItemEditorModal
          draft={itemModal}
          groups={groups}
          saving={itemSaving}
          onChange={(updates) =>
            setItemModal((current) =>
              current
                ? {
                    ...current,
                    ...(typeof updates === "function" ? updates(current) : updates),
                  }
                : current,
            )
          }
          onClose={() => setItemModal(null)}
          onSave={saveItem}
          showAlert={showAlert}
        />
      ) : null}
    </div>
  );
}

// ============================================================================
// Group list view (展柜列表)
// ============================================================================

function GroupManager({
  groups,
  hasSearch,
  keyword,
  onKeywordChange,
  selected,
  onToggleSelected,
  reorderSaving,
  busy,
  onCreate,
  onDeleteSelected,
  onEnter,
  onRename,
  onMoveUp,
  onMoveDown,
}: {
  groups: ShowcaseGroupWithItems[];
  hasSearch: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  selected: ReadonlySet<number>;
  onToggleSelected: (id: number) => void;
  reorderSaving: boolean;
  busy: boolean;
  onCreate: () => void;
  onDeleteSelected: () => void;
  onEnter: (group: ShowcaseGroupWithItems) => void;
  onRename: (group: ShowcaseGroupWithItems) => void;
  onMoveUp: (group: ShowcaseGroupWithItems) => void;
  onMoveDown: (group: ShowcaseGroupWithItems) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full flex-col gap-4">
      <ListToolbar
        keyword={keyword}
        onKeywordChange={onKeywordChange}
        placeholder={t("showcase.admin.search_groups_placeholder")}
        selectedCount={selected.size}
        busy={busy}
        onDelete={onDeleteSelected}
        deleteTitle={t("delete.title")}
        onCreate={onCreate}
        createTitle={t("showcase.admin.group_add")}
      />

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-black/10 bg-w px-4 py-12 text-center dark:border-white/10">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {hasSearch ? t("showcase.admin.no_match") : t("showcase.admin.groups_empty_title")}
          </p>
          {!hasSearch ? (
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              {t("showcase.admin.groups_empty_description")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-w dark:border-white/10">
          {groups.map((group, index) => {
            const checked = selected.has(group.id);
            const first = index === 0;
            const last = index === groups.length - 1;
            return (
              <div
                key={group.id}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  index > 0 ? "border-t border-black/5 dark:border-white/5" : ""
                } hover:bg-black/[0.02] dark:hover:bg-white/[0.03]`}
              >
                <label className="flex shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleSelected(group.id)}
                    className="h-4 w-4 accent-theme"
                    aria-label={group.name}
                  />
                </label>

                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <i className="ri-store-2-line shrink-0 text-lg text-theme/70" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium t-primary">{group.name}</p>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      {t("showcase.admin.group_item_count$count", { count: filterShowcaseItems(group.items).length })}
                    </p>
                  </div>
                </div>

                {/* ↑ / ↓ ordering buttons */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onMoveUp(group)}
                    disabled={first || reorderSaving || hasSearch}
                    title={t("showcase.admin.move_up")}
                    aria-label={t("showcase.admin.move_up")}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <i className="ri-arrow-up-s-line text-lg" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveDown(group)}
                    disabled={last || reorderSaving || hasSearch}
                    title={t("showcase.admin.move_down")}
                    aria-label={t("showcase.admin.move_down")}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <i className="ri-arrow-down-s-line text-lg" aria-hidden="true" />
                  </button>
                </div>

                {/* wrench: manage this showcase's entries */}
                <button
                  type="button"
                  onClick={() => onEnter(group)}
                  title={t("showcase.admin.enter_items")}
                  aria-label={t("showcase.admin.enter_items")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <i className="ri-tools-line text-sm" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => onRename(group)}
                  title={t("showcase.admin.group_edit")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <i className="ri-pencil-line text-sm" aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {reorderSaving ? (
            <p className="flex items-center gap-2 border-t border-black/5 px-4 py-2 text-xs text-neutral-400 dark:border-white/5">
              <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
              {t("showcase.admin.saving_order")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Entry list view (单个展柜的条目列表)
// ============================================================================

function ItemManager({
  group,
  items,
  hasSearch,
  keyword,
  onKeywordChange,
  selected,
  onToggleSelected,
  reorderSaving,
  busy,
  onBack,
  onCreate,
  onDeleteSelected,
  onEdit,
  onMoveUp,
  onMoveDown,
}: {
  group: ShowcaseGroupWithItems;
  items: ShowcaseItem[];
  hasSearch: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  selected: ReadonlySet<number>;
  onToggleSelected: (id: number) => void;
  reorderSaving: boolean;
  busy: boolean;
  onBack: () => void;
  onCreate: () => void;
  onDeleteSelected: () => void;
  onEdit: (item: ShowcaseItem) => void;
  onMoveUp: (item: ShowcaseItem) => void;
  onMoveDown: (item: ShowcaseItem) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full flex-col gap-4">
      <ListToolbar
        keyword={keyword}
        onKeywordChange={onKeywordChange}
        placeholder={t("showcase.admin.search_items_placeholder")}
        selectedCount={selected.size}
        busy={busy}
        onDelete={onDeleteSelected}
        deleteTitle={t("delete.title")}
        onCreate={onCreate}
        createTitle={t("showcase.admin.item_add")}
        onBack={onBack}
        backTitle={t("showcase.admin.back_to_groups")}
        contextLabel={group.name}
      />

      {items.length === 0 ? (
        <div className="rounded-2xl border border-black/10 bg-w px-4 py-12 text-center dark:border-white/10">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {hasSearch ? t("showcase.admin.no_match") : t("showcase.admin.items_empty_title")}
          </p>
          {!hasSearch ? (
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              {t("showcase.admin.items_empty_description")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-w dark:border-white/10">
          {items.map((item, index) => {
            const images = item.images ?? [];
            const cover = images[0] ?? "";
            const checked = selected.has(item.id);
            const first = index === 0;
            const last = index === items.length - 1;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  index > 0 ? "border-t border-black/5 dark:border-white/5" : ""
                } hover:bg-black/[0.02] dark:hover:bg-white/[0.03]`}
              >
                <label className="flex shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleSelected(item.id)}
                    className="h-4 w-4 accent-theme"
                    aria-label={item.title || t("showcase.untitled")}
                  />
                </label>

                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <ImageWithFallback
                    src={cover}
                    alt={item.title || t("showcase.untitled")}
                    className="h-12 w-12 shrink-0 rounded-lg border border-black/5 dark:border-white/10"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium t-primary">
                      {item.title || t("showcase.untitled")}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                      <i className="ri-image-line text-[0.9em]" aria-hidden="true" />
                      {t("showcase.admin.item_image_count$count", { count: images.length })}
                      {item.desc ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.desc}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>

                {/* ↑ / ↓ ordering buttons */}
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onMoveUp(item)}
                    disabled={first || reorderSaving || hasSearch}
                    title={t("showcase.admin.move_up")}
                    aria-label={t("showcase.admin.move_up")}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <i className="ri-arrow-up-s-line text-lg" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveDown(item)}
                    disabled={last || reorderSaving || hasSearch}
                    title={t("showcase.admin.move_down")}
                    aria-label={t("showcase.admin.move_down")}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    <i className="ri-arrow-down-s-line text-lg" aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  title={t("showcase.admin.item_edit")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <i className="ri-pencil-line text-sm" aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {reorderSaving ? (
            <p className="flex items-center gap-2 border-t border-black/5 px-4 py-2 text-xs text-neutral-400 dark:border-white/5">
              <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
              {t("showcase.admin.saving_order")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Item editor modal
// ============================================================================

function ItemEditorModal({
  draft,
  groups,
  saving,
  onChange,
  onClose,
  onSave,
  showAlert,
}: {
  draft: ItemDraft;
  groups: ShowcaseGroupWithItems[];
  saving: boolean;
  onChange: (
    updates: Partial<ItemDraft> | ((current: ItemDraft) => Partial<ItemDraft>),
  ) => void;
  onClose: () => void;
  onSave: () => void;
  showAlert: (message: string) => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [quickUrl, setQuickUrl] = useState("");

  const setImage = (index: number, url: string) => {
    onChange((current) => {
      const next = [...current.images];
      next[index] = url;
      return { images: next };
    });
  };

  const moveImage = (index: number, delta: -1 | 1) => {
    onChange((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.images.length) return {};
      const next = [...current.images];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { images: next };
    });
  };

  const removeImage = (index: number) => {
    onChange((current) => ({
      images: current.images.filter((_, i) => i !== index),
    }));
  };

  const addQuickUrl = () => {
    const url = quickUrl.trim();
    if (!url) return;
    onChange((current) => ({ images: [...current.images, url] }));
    setQuickUrl("");
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!isImageFile(file)) {
          showAlert(t("showcase.admin.item_image_invalid_type"));
          continue;
        }
        if (file.size > DEFAULT_IMAGE_MAX_FILE_SIZE) {
          showAlert(t("upload.failed$size", { size: Math.round(DEFAULT_IMAGE_MAX_FILE_SIZE / 1024 / 1024) }));
          continue;
        }
        try {
          const result = await uploadImageFile(file);
          onChange((current) => ({ images: [...current.images, result.url] }));
        } catch (uploadError) {
          showAlert(uploadError instanceof Error ? uploadError.message : t("upload.failed"));
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const showcaseOptions = groups.map((group) => ({
    label: group.name,
    value: String(group.id),
  }));

  const textClass =
    "w-full rounded-xl border border-black/10 bg-w px-4 py-3 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20";

  return (
    <Modal
      isOpen
      onRequestClose={onClose}
      contentLabel={draft.id === null ? t("showcase.admin.item_add") : t("showcase.admin.item_edit")}
      size="lg"
      panelClassName="p-6"
    >
      <div className="flex w-full flex-col items-start">
        <div className="flex w-full items-start justify-between gap-4">
          <h2 className="text-xl font-bold tracking-[-0.02em] t-primary">
            {draft.id === null ? t("showcase.admin.item_add") : t("showcase.admin.item_edit")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary t-primary bg-button"
          >
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>

        <label className="mt-4 text-sm font-medium t-primary">{t("showcase.admin.item_showcase")}</label>
        <div className="mt-2 w-full">
          <SearchableSelect
            value={String(draft.showcaseId)}
            onChange={(value) => {
              const parsed = Number(value);
              if (!Number.isNaN(parsed) && parsed > 0) {
                onChange({ showcaseId: parsed });
              }
            }}
            options={showcaseOptions}
            placeholder={t("showcase.admin.item_showcase")}
            searchable={false}
          />
        </div>

        <label className="mt-4 text-sm font-medium t-primary">{t("showcase.admin.item_title")}</label>
        <Input
          value={draft.title}
          setValue={(value) => onChange({ title: value })}
          placeholder={t("showcase.admin.item_title_placeholder")}
          variant="flat"
          className="mt-2"
        />

        <div className="mt-5 flex w-full items-center justify-between">
          <label className="text-sm font-medium t-primary">{t("showcase.admin.item_images")}</label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-w px-3 py-1.5 text-sm t-primary transition-colors hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:border-white/20"
          >
            {uploading ? (
              <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
            ) : (
              <i className="ri-upload-2-line" aria-hidden="true" />
            )}
            {uploading ? t("uploading") : t("showcase.admin.item_images_upload")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(event) => void handleFiles(event.target.files)}
          />
        </div>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("showcase.admin.item_images_hint")}</p>

        <div className="mt-2 w-full space-y-2">
          {draft.images.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-neutral-400 dark:border-white/10">
              {t("showcase.admin.item_images_empty")}
            </p>
          ) : (
            draft.images.map((url, index) => (
              <div key={`${index}-${url.slice(0, 40)}`} className="flex items-center gap-2">
                <ImageWithFallback
                  src={url}
                  alt={`${index + 1}`}
                  className="h-12 w-12 shrink-0 rounded-lg border border-black/5 dark:border-white/10"
                />
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setImage(index, event.target.value)}
                  className={textClass}
                />
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveImage(index, -1)}
                    disabled={index === 0}
                    aria-label={t("showcase.admin.item_image_up")}
                    className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-white/10"
                  >
                    <i className="ri-arrow-up-s-line" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveImage(index, 1)}
                    disabled={index === draft.images.length - 1}
                    aria-label={t("showcase.admin.item_image_down")}
                    className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-white/10"
                  >
                    <i className="ri-arrow-down-s-line" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  aria-label={t("showcase.admin.item_image_remove")}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <i className="ri-close-line text-sm" aria-hidden="true" />
                </button>
              </div>
            ))
          )}

          {/* Quick add image by URL */}
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={quickUrl}
              onChange={(event) => setQuickUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addQuickUrl();
                }
              }}
              placeholder={t("showcase.admin.item_image_url_placeholder")}
              className={textClass}
            />
            <button
              type="button"
              onClick={addQuickUrl}
              disabled={!quickUrl.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-secondary px-3 py-3 text-sm t-primary bg-button disabled:opacity-50"
            >
              <i className="ri-add-line" aria-hidden="true" />
              {t("showcase.admin.item_image_add")}
            </button>
          </div>
        </div>

        <label className="mt-5 text-sm font-medium t-primary">{t("showcase.admin.item_desc")}</label>
        <textarea
          value={draft.desc}
          onChange={(event) => onChange({ desc: event.target.value })}
          placeholder={t("showcase.admin.item_desc_placeholder")}
          className={`mt-2 min-h-28 ${textClass}`}
        />

        <div className="mt-6 flex w-full flex-row justify-end gap-3">
          <FlatActionButton onClick={onClose} className="text-neutral-500 dark:text-neutral-400">
            {t("cancel")}
          </FlatActionButton>
          <FlatActionButton onClick={onSave} className="t-primary" disabled={saving || uploading}>
            {saving ? t("saving") : t("save")}
          </FlatActionButton>
        </div>
      </div>
    </Modal>
  );
}
