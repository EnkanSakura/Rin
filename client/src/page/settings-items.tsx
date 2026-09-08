import * as Switch from "@radix-ui/react-switch";
import { type ChangeEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { Button } from "../components/button";
import { useConfirm } from "../components/dialog";
import { ImageUploadInput } from "../components/image-upload-input";
import { ImageWithFallback } from "../components/image-with-fallback";
import {
  SearchableSelect,
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsCardRow,
  SettingsSectionTitle,
} from "@rin/ui";

export function ItemTitle({ title }: { title: string }) {
  return <SettingsSectionTitle title={title} />;
}

export function ItemSwitch({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={title} description={description} />}
          action={
            <Switch.Root className="SwitchRoot" checked={checked} onCheckedChange={onChange}>
              <Switch.Thumb className="SwitchThumb" />
            </Switch.Root>
          }
        />
      </SettingsCard>
    </div>
  );
}

export function ItemInput({
  title,
  configKeyTitle,
  description,
  value,
  placeholder,
  onChange,
}: {
  title: string;
  description: string;
  configKeyTitle: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full">
      <SettingsCard>
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => {
            setIsOpen((current) => {
              return !current;
            });
          }}
        >
          <SettingsCardRow
            header={<SettingsCardHeader title={title} description={description} />}
            action={
              <div className="flex items-center gap-3">
                <span className="max-w-56 truncate text-sm text-neutral-500 dark:text-neutral-400">
                  {value || placeholder || configKeyTitle}
                </span>
                <i
                  className={`ri-arrow-down-s-line text-lg text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </div>
            }
          />
        </button>
        {isOpen ? (
          <SettingsCardBody>
            <textarea
              placeholder={placeholder || configKeyTitle}
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
              }}
              className="min-h-36 w-full rounded-xl border border-black/10 bg-w px-4 py-3 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
            />
          </SettingsCardBody>
        ) : null}
      </SettingsCard>
    </div>
  );
}

export function ItemSelect({
  title,
  description,
  value,
  options,
  placeholder,
  onChange,
}: {
  title: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={title} description={description} />}
          action={
            <SearchableSelect
              value={value}
              onChange={onChange}
              options={options}
              placeholder={placeholder ?? title}
              emptyLabel={t("no_more")}
              searchable={false}
            />
          }
        />
      </SettingsCard>
    </div>
  );
}

export function ItemButton({
  title,
  description,
  buttonTitle,
  onConfirm,
  alertTitle,
  alertDescription,
}: {
  title: string;
  description: string;
  buttonTitle: string;
  onConfirm: () => Promise<void>;
  alertTitle: string;
  alertDescription: string;
}) {
  const { showConfirm, ConfirmUI } = useConfirm();

  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={title} description={description} />}
          action={
            <Button
              title={buttonTitle}
              onClick={() => {
                showConfirm(alertTitle, alertDescription, onConfirm);
              }}
            />
          }
        />
      </SettingsCard>
      <ConfirmUI />
    </div>
  );
}

export function ItemWithUpload({
  title,
  description,
  accept,
  onFileChange,
}: {
  title: string;
  description: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  accept: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    setLoading(true);
    try {
      await onFileChange(event);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={title} description={description} />}
          action={
            <>
              {loading && <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />}
              <input ref={inputRef} type="file" className="hidden" accept={accept} onChange={handleFileChange} />
              <Button
                onClick={() => {
                  inputRef.current?.click();
                }}
                title={t("upload.title")}
              />
            </>
          }
        />
      </SettingsCard>
    </div>
  );
}

// ── External Links (name / url / icon) ───────────────────────────

export interface ExternalLink {
  name: string;
  url: string;
  icon: string;
}

export function ItemExternalLinks({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();

  // Parse current JSON value into an array
  const links: ExternalLink[] = (() => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  function updateLinks(newLinks: ExternalLink[]) {
    onChange(JSON.stringify(newLinks));
  }

  function addLink() {
    updateLinks([...links, { name: "", url: "", icon: "" }]);
  }

  function removeLink(index: number) {
    const next = links.filter((_, i) => i !== index);
    updateLinks(next);
  }

  function updateLink(index: number, field: keyof ExternalLink, val: string) {
    const next = links.map((link, i) =>
      i === index ? { ...link, [field]: val } : link,
    );
    updateLinks(next);
  }

  return (
    <div className="w-full">
      <SettingsCard>
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => setIsOpen((c) => !c)}
        >
          <SettingsCardRow
            header={<SettingsCardHeader title={title} description={description} />}
            action={
              <div className="flex items-center gap-3">
                <span className="max-w-56 truncate text-sm text-neutral-500 dark:text-neutral-400">
                  {links.length > 0
                    ? t("settings.site.external_links.count", { count: links.length })
                    : t("settings.site.external_links.empty")}
                </span>
                <i
                  className={`ri-arrow-down-s-line text-lg text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </div>
            }
          />
        </button>
        {isOpen && (
          <SettingsCardBody>
            <div className="space-y-3">
              {links.length === 0 && (
                <p className="text-center text-sm text-neutral-400">{t("settings.site.external_links.empty_desc")}</p>
              )}
              {links.map((link, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-black/10 bg-w p-4 dark:border-white/10"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">#{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeLink(i)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-red-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      title={t("settings.site.external_links.delete")}
                    >
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                  <div className="grid gap-2">
                    <input
                      type="text"
                      placeholder={t("settings.site.external_links.placeholder_name")}
                      value={link.name}
                      onChange={(e) => updateLink(i, "name", e.target.value)}
                      className="w-full rounded-lg border border-black/10 bg-w px-3 py-2 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
                    />
                    <input
                      type="text"
                      placeholder={t("settings.site.external_links.placeholder_url")}
                      value={link.url}
                      onChange={(e) => updateLink(i, "url", e.target.value)}
                      className="w-full rounded-lg border border-black/10 bg-w px-3 py-2 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
                    />
                    <input
                      type="text"
                      placeholder={t("settings.site.external_links.placeholder_icon")}
                      value={link.icon}
                      onChange={(e) => updateLink(i, "icon", e.target.value)}
                      className="w-full rounded-lg border border-black/10 bg-w px-3 py-2 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
                    />
                  </div>
                  {link.icon && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <span>{t("settings.site.external_links.preview")}</span>
                      <i className={`${link.icon} text-base`} />
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addLink}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/10 py-3 text-sm text-neutral-500 transition-colors hover:border-theme/30 hover:text-theme dark:border-white/10 dark:hover:border-theme/30"
              >
                <i className="ri-add-line" />
                {t("settings.site.external_links.add")}
              </button>
            </div>
          </SettingsCardBody>
        )}
      </SettingsCard>
    </div>
  );
}

export function ItemImageInput({
  title,
  description,
  configKeyTitle,
  value,
  placeholder,
  onChange,
  onError,
  shape = "rounded",
}: {
  title: string;
  description: string;
  configKeyTitle: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onError?: (message: string) => void;
  shape?: "rounded" | "circle";
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full">
      <SettingsCard>
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => {
            setIsOpen((current) => !current);
          }}
        >
          <SettingsCardRow
            header={<SettingsCardHeader title={title} description={description} />}
            action={
              <div className="flex items-center gap-3">
                {value ? (
                  <ImageWithFallback
                    src={value}
                    alt={configKeyTitle}
                    className={`h-10 w-10 ${shape === "circle" ? "rounded-full" : "rounded-2xl"}`}
                  />
                ) : null}
                <span className="max-w-56 truncate text-sm text-neutral-500 dark:text-neutral-400">
                  {value || placeholder || configKeyTitle}
                </span>
                <i
                  className={`ri-arrow-down-s-line text-lg text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </div>
            }
          />
        </button>
        {isOpen ? (
          <SettingsCardBody>
            <ImageUploadInput
              value={value}
              onChange={onChange}
              onError={onError}
              placeholder={placeholder || configKeyTitle}
              shape={shape}
            />
          </SettingsCardBody>
        ) : null}
      </SettingsCard>
    </div>
  );
}

export interface ChecklistOption {
  id: string;
  label: string;
}

export function ItemDraggableChecklist({
  title,
  description,
  allOptions,
  value,
  onChange,
}: {
  title: string;
  description: string;
  allOptions: ChecklistOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const enabledIds: string[] = (() => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const orderedOptions = (() => {
    const enabled = new Set(enabledIds);
    const enabledList = enabledIds
      .map((id) => allOptions.find((o) => o.id === id))
      .filter((o): o is ChecklistOption => o !== undefined);
    const disabledList = allOptions.filter((o) => !enabled.has(o.id));
    return [...enabledList, ...disabledList];
  })();

  function updateConfig(newOrdered: ChecklistOption[], enabled: Set<string>) {
    const result = newOrdered.filter((item) => enabled.has(item.id)).map((item) => item.id);
    onChange(JSON.stringify(result));
  }

  function handleDragStart(index: number) {
    setDragIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const items = [...orderedOptions];
    const [moved] = items.splice(dragIndex, 1);
    items.splice(index, 0, moved);
    setDragIndex(index);
    updateConfig(items, new Set(enabledIds));
  }

  function handleDragEnd() {
    setDragIndex(null);
  }

  function handleToggle(id: string, checked: boolean) {
    const enabled = new Set(enabledIds);
    if (checked) enabled.add(id);
    else enabled.delete(id);
    updateConfig(orderedOptions, enabled);
  }

  return (
    <div className="w-full">
      <SettingsCard>
        <button type="button" className="block w-full text-left" onClick={() => setIsOpen((c) => !c)}>
          <SettingsCardRow
            header={<SettingsCardHeader title={title} description={description} />}
            action={
              <div className="flex items-center gap-3">
                <span className="max-w-56 truncate text-sm text-neutral-500 dark:text-neutral-400">
                  {enabledIds.length > 0
                    ? t("settings.selected_count", { count: enabledIds.length })
                    : t("settings.not_configured")}
                </span>
                <i className={`ri-arrow-down-s-line text-lg text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </div>
            }
          />
        </button>
        {isOpen && (
          <SettingsCardBody>
            <div className="space-y-1">
              {orderedOptions.map((option, index) => {
                const isEnabled = enabledIds.includes(option.id);
                const isDragging = dragIndex === index;
                return (
                  <div
                    key={option.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isDragging
                        ? "opacity-50 ring-2 ring-theme/30"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    } ${isEnabled ? "" : "opacity-60"}`}
                  >
                    <i className="ri-draggable cursor-grab text-neutral-400 active:cursor-grabbing" />
                    <label className="flex cursor-pointer items-center gap-2 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => handleToggle(option.id, e.target.checked)}
                        className="h-4 w-4 accent-theme"
                      />
                      <span className="t-primary truncate">{option.label}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </SettingsCardBody>
        )}
      </SettingsCard>
    </div>
  );
}