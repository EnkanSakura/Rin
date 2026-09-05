import {
  FlatActionButton,
  Modal,
  SearchableSelect,
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@rin/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { useAlert, useConfirm } from "../components/dialog";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Input } from "../components/input";
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
// Admin Showcase management page (展柜管理)
// ============================================================================

export function AdminShowcasePage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();

  const [activeTab, setActiveTab] = useState(0);
  const [groups, setGroups] = useState<ShowcaseGroupWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);

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
        setActiveGroupId((current) => {
          if (current !== null && parsed.some((group) => group.id === current)) return current;
          return parsed[0]?.id ?? null;
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeGroup = useMemo(() => {
    const group = groups.find((candidate) => candidate.id === activeGroupId);
    return group ?? groups[0] ?? null;
  }, [groups, activeGroupId]);

  const activeItems = useMemo(
    () => filterShowcaseItems(activeGroup?.items),
    [activeGroup],
  );

  // ── Group CRUD ──────────────────────────────────────────────────────────

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

  function removeGroup(group: ShowcaseGroupWithItems) {
    showConfirm(
      t("showcase.admin.group_delete_confirm_title"),
      t("showcase.admin.group_delete_confirm_description", { name: group.name }),
      async () => {
        const { error: deleteError } = await client.showcase.deleteGroup(group.id);
        if (deleteError) {
          showAlert(deleteError.value);
          return;
        }
        showAlert(t("showcase.admin.group_delete_success"));
        load();
      },
    );
  }

  function commitGroupOrder(ordered: ShowcaseGroupWithItems[]) {
    const ids = ordered.map((group) => group.id);
    setGroups(ordered);
    setReorderSaving(true);
    client.showcase
      .reorderGroups({ ids })
      .then(({ error: saveError }) => {
        if (saveError) {
          showAlert(saveError.value);
          load();
          return;
        }
        showAlert(t("showcase.admin.reorder_success"));
      })
      .finally(() => setReorderSaving(false));
  }

  // ── Item CRUD ───────────────────────────────────────────────────────────

  function openCreateItem() {
    if (!activeGroup) return;
    setItemModal({
      id: null,
      showcaseId: activeGroup.id,
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

  function removeItem(item: ShowcaseItem) {
    showConfirm(
      t("showcase.admin.item_delete_confirm_title"),
      t("showcase.admin.item_delete_confirm_description", {
        title: item.title || t("showcase.untitled"),
      }),
      async () => {
        const { error: deleteError } = await client.showcase.deleteItem(item.id);
        if (deleteError) {
          showAlert(deleteError.value);
          return;
        }
        showAlert(t("showcase.admin.item_delete_success"));
        load();
      },
    );
  }

  function commitItemOrder(ordered: ShowcaseItem[]) {
    const ids = ordered.map((item) => item.id);
    setGroups((current) =>
      current.map((group) =>
        group.id === ordered[0]?.showcaseId
          ? { ...group, items: ordered }
          : group,
      ),
    );
    setReorderSaving(true);
    client.showcase
      .reorderItems({ ids })
      .then(({ error: saveError }) => {
        if (saveError) {
          showAlert(saveError.value);
          load();
          return;
        }
        showAlert(t("showcase.admin.reorder_success"));
      })
      .finally(() => setReorderSaving(false));
  }

  const tabBar = (
    <div className="mb-4 flex overflow-x-auto rounded-2xl border border-black/10 bg-w p-1 dark:border-white/10">
      {[
        { key: "groups", label: t("showcase.admin.tab_groups") },
        { key: "items", label: t("showcase.admin.tab_items") },
      ].map((tab, i) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => setActiveTab(i)}
          className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all ${
            activeTab === i
              ? "bg-neutral-100 text-black shadow-sm dark:bg-white/10 dark:text-white"
              : "text-neutral-500 hover:text-black dark:hover:text-white"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex w-full flex-col">
      <Helmet>
        <title>{`${t("showcase.admin.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      <AlertUI />
      <ConfirmUI />

      {tabBar}

      {loading ? (
        <div className="flex items-center gap-3 py-8 text-sm text-neutral-500 dark:text-neutral-400">
          <ReactLoading width="1.25em" height="1.25em" type="spin" color="#FC466B" />
          <span>{t("showcase.admin.loading")}</span>
        </div>
      ) : null}

      {error ? (
        <SettingsCard tone="danger">
          <SettingsCardHeader title={t("showcase.admin.load_failed")} description={error} />
        </SettingsCard>
      ) : null}

      {!loading && !error && activeTab === 0 && (
        <GroupManager
          groups={groups}
          reorderSaving={reorderSaving}
          onCreate={openCreateGroup}
          onRename={openRenameGroup}
          onDelete={removeGroup}
          onReorder={commitGroupOrder}
        />
      )}

      {!loading && !error && activeTab === 1 && (
        <ItemManager
          groups={groups}
          activeGroupId={activeGroup?.id ?? null}
          activeGroup={activeGroup}
          items={activeItems}
          reorderSaving={reorderSaving}
          onSelectGroup={(id) => setActiveGroupId(id)}
          onShowGroupTab={() => setActiveTab(0)}
          onCreate={openCreateItem}
          onEdit={openEditItem}
          onDelete={removeItem}
          onReorder={commitItemOrder}
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
// Group manager panel (展柜管理选项卡)
// ============================================================================

function GroupManager({
  groups,
  reorderSaving,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: {
  groups: ShowcaseGroupWithItems[];
  reorderSaving: boolean;
  onCreate: () => void;
  onRename: (group: ShowcaseGroupWithItems) => void;
  onDelete: (group: ShowcaseGroupWithItems) => void;
  onReorder: (ordered: ShowcaseGroupWithItems[]) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full flex-col gap-4">
      <SettingsCard>
        <SettingsCardHeader
          title={t("showcase.admin.groups_guide_title")}
          description={t("showcase.admin.groups_guide_description")}
          badge={<Button onClick={onCreate} title={t("showcase.admin.group_add")} />}
        />
      </SettingsCard>

      {groups.length === 0 ? (
        <SettingsCard>
          <SettingsCardHeader
            title={t("showcase.admin.groups_empty_title")}
            description={t("showcase.admin.groups_empty_description")}
          />
        </SettingsCard>
      ) : (
        <SettingsCard>
          <SettingsCardBody>
            <div className="space-y-1">
              {groups.map((group, index) => (
                <DraggableRow
                  key={group.id}
                  index={index}
                  length={groups.length}
                  onReorder={(from, to) => {
                    const next = [...groups];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    onReorder(next);
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1">
                    <i className="ri-store-2-line text-lg text-theme/70" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium t-primary">{group.name}</p>
                      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        {t("showcase.admin.group_item_count$count", { count: filterShowcaseItems(group.items).length })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRename(group)}
                      title={t("showcase.admin.group_edit")}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <i className="ri-pencil-line text-sm" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(group)}
                      title={t("delete.title")}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    >
                      <i className="ri-delete-bin-line text-sm" aria-hidden="true" />
                    </button>
                  </div>
                </DraggableRow>
              ))}
              {reorderSaving ? (
                <p className="flex items-center gap-2 px-2 pt-1 text-xs text-neutral-400">
                  <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
                  {t("showcase.admin.saving_order")}
                </p>
              ) : null}
            </div>
          </SettingsCardBody>
        </SettingsCard>
      )}
    </div>
  );
}

// ============================================================================
// Item manager panel (条目管理选项卡)
// ============================================================================

function ItemManager({
  groups,
  activeGroup,
  activeGroupId,
  items,
  reorderSaving,
  onSelectGroup,
  onShowGroupTab,
  onCreate,
  onEdit,
  onDelete,
  onReorder,
}: {
  groups: ShowcaseGroupWithItems[];
  activeGroup: ShowcaseGroupWithItems | null;
  activeGroupId: number | null;
  items: ShowcaseItem[];
  reorderSaving: boolean;
  onSelectGroup: (id: number) => void;
  onShowGroupTab: () => void;
  onCreate: () => void;
  onEdit: (item: ShowcaseItem) => void;
  onDelete: (item: ShowcaseItem) => void;
  onReorder: (ordered: ShowcaseItem[]) => void;
}) {
  const { t } = useTranslation();

  if (groups.length === 0) {
    return (
      <SettingsCard>
        <SettingsCardHeader
          title={t("showcase.admin.items_no_groups_title")}
          description={t("showcase.admin.items_no_groups_description")}
          badge={<Button secondary onClick={onShowGroupTab} title={t("showcase.admin.tab_groups")} />}
        />
      </SettingsCard>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Showcase tabs (mirrors the public page) */}
      <div className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => onSelectGroup(group.id)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-all ${
              group.id === activeGroupId
                ? "bg-theme text-white"
                : "border border-black/10 bg-w text-neutral-600 hover:border-black/20 dark:border-white/10 dark:text-neutral-300"
            }`}
          >
            {group.name}
          </button>
        ))}
      </div>

      <SettingsCard>
        <SettingsCardHeader
          title={activeGroup ? t("showcase.admin.items_guide_title$name", { name: activeGroup.name }) : ""}
          description={t("showcase.admin.items_guide_description")}
          badge={<Button onClick={onCreate} title={t("showcase.admin.item_add")} />}
        />
      </SettingsCard>

      {items.length === 0 ? (
        <SettingsCard>
          <SettingsCardHeader
            title={t("showcase.admin.items_empty_title")}
            description={t("showcase.admin.items_empty_description")}
          />
        </SettingsCard>
      ) : (
        <SettingsCard>
          <SettingsCardBody>
            <div className="space-y-1">
              {items.map((item, index) => {
                const images = item.images ?? [];
                const cover = images[0] ?? "";
                return (
                  <DraggableRow
                    key={item.id}
                    index={index}
                    length={items.length}
                    onReorder={(from, to) => {
                      const next = [...items];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      onReorder(next);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1">
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
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        title={t("showcase.admin.item_edit")}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                      >
                        <i className="ri-pencil-line text-sm" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        title={t("delete.title")}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      >
                        <i className="ri-delete-bin-line text-sm" aria-hidden="true" />
                      </button>
                    </div>
                  </DraggableRow>
                );
              })}
              {reorderSaving ? (
                <p className="flex items-center gap-2 px-2 pt-1 text-xs text-neutral-400">
                  <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
                  {t("showcase.admin.saving_order")}
                </p>
              ) : null}
            </div>
          </SettingsCardBody>
        </SettingsCard>
      )}
    </div>
  );
}

// ============================================================================
// HTML5 drag-and-drop row helper
// ============================================================================

function DraggableRow({
  index,
  length,
  onReorder,
  children,
}: {
  index: number;
  length: number;
  onReorder: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const dragIndex = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);

  return (
    <div
      draggable
      onDragStart={() => {
        dragIndex.current = index;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        if (dragIndex.current !== null && dragIndex.current !== index) {
          onReorder(dragIndex.current, index);
        }
        dragIndex.current = null;
        setDragging(false);
        setOver(false);
      }}
      onDragEnd={() => {
        dragIndex.current = null;
        setDragging(false);
        setOver(false);
      }}
      className={`flex cursor-grab items-center gap-1 rounded-xl text-sm transition-colors active:cursor-grabbing ${
        dragging ? "opacity-60 ring-2 ring-theme/30" : ""
      } ${over ? "bg-neutral-50 dark:bg-white/5" : ""}`}
    >
      <i
        className="ri-draggable shrink-0 cursor-grab text-neutral-400 active:cursor-grabbing"
        aria-hidden="true"
      />
      <div className={`flex min-w-0 flex-1 items-center gap-1 rounded-lg py-1 ${length === 1 ? "pointer-events-none" : ""}`}>
        {children}
      </div>
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
