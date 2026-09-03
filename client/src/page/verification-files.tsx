import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import Modal from "react-modal";
import ReactLoading from "react-loading";
import { FlatActionButton, FlatPanel, SettingsCard, SettingsCardBody, SettingsCardHeader } from "@rin/ui";
import type { VerificationFile } from "@rin/api";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { useAlert, useConfirm } from "../components/dialog";
import { Input } from "../components/input";
import { useSiteConfig } from "../hooks/useSiteConfig";

export function VerificationFilesPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<VerificationFile[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VerificationFile | null>(null);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const { showAlert, AlertUI } = useAlert();
  const { showConfirm, ConfirmUI } = useConfirm();

  const load = () => {
    setLoading(true);
    setError(null);
    client.verificationFiles
      .list()
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError(loadError.value);
          return;
        }
        if (data) {
          setItems(Array.isArray(data.list) ? data.list : []);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setPath("");
    setContent("");
    setModalOpen(true);
  };

  const openEdit = (item: VerificationFile) => {
    setEditing(item);
    setPath(item.path);
    setContent(item.content);
    setModalOpen(true);
  };

  const save = () => {
    setSaving(true);
    const payload = { path: path.trim(), content };
    const request = editing
      ? client.verificationFiles.update(editing.id, payload)
      : client.verificationFiles.create(payload);

    request
      .then(({ error: saveError }) => {
        if (saveError) {
          showAlert(saveError.value);
          return;
        }
        showAlert(t("verification_files.save_success"));
        setModalOpen(false);
        load();
      })
      .finally(() => setSaving(false));
  };

  const remove = (item: VerificationFile) => {
    showConfirm(
      t("verification_files.delete_confirm_title"),
      t("verification_files.delete_confirm_description", { path: item.path }),
      async () => {
        setActingId(item.id);
        try {
          const { error: deleteError } = await client.verificationFiles.delete(item.id);
          if (deleteError) {
            showAlert(deleteError.value);
            return;
          }
          showAlert(t("verification_files.delete_success"));
          load();
        } finally {
          setActingId(null);
        }
      },
    );
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="flex w-full flex-col gap-4">
      <Helmet>
        <title>{`${t("verification_files.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      <AlertUI />
      <ConfirmUI />

      <div className="flex flex-col gap-4">
        <SettingsCard>
          <SettingsCardHeader
            title={t("verification_files.guide_title")}
            description={t("verification_files.guide_description")}
            badge={<Button onClick={openCreate} title={t("verification_files.add")} />}
          />
        </SettingsCard>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-8 text-sm text-neutral-500 dark:text-neutral-400">
          <ReactLoading width="1.25em" height="1.25em" type="spin" color="#FC466B" />
          <span>{t("verification_files.loading")}</span>
        </div>
      ) : null}

      {error ? (
        <SettingsCard tone="danger">
          <SettingsCardHeader title={t("verification_files.load_failed")} description={error} />
        </SettingsCard>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <SettingsCard>
          <SettingsCardHeader title={t("verification_files.empty_title")} description={t("verification_files.empty_description")} />
        </SettingsCard>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="space-y-4">
          {items.map((item) => (
            <SettingsCard key={`${item.id}-${item.path}`}>
              <SettingsCardBody>
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <code className="break-all rounded-lg bg-neutral-100 px-2 py-1 text-[13px] font-medium t-primary dark:bg-white/10">
                      {item.path}
                    </code>
                    <a
                      href={`${origin}${item.path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 break-all text-theme hover:underline"
                    >
                      <i className="ri-external-link-line text-sm" aria-hidden="true" />
                      {t("verification_files.open")}
                    </a>
                  </div>
                  <pre className="whitespace-pre-wrap break-all rounded-xl border border-black/10 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">
                    {item.content}
                  </pre>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      title={actingId === item.id ? t("verification_files.deleting") : t("verification_files.delete")}
                      secondary
                      disabled={actingId !== null}
                      onClick={() => remove(item)}
                    />
                    <Button title={t("verification_files.edit")} disabled={actingId !== null} onClick={() => openEdit(item)} />
                  </div>
                </div>
              </SettingsCardBody>
            </SettingsCard>
          ))}
        </div>
      ) : null}

      <Modal
        isOpen={modalOpen}
        onRequestClose={() => setModalOpen(false)}
        style={{
          content: {
            top: "50%",
            left: "50%",
            right: "auto",
            bottom: "auto",
            marginRight: "-50%",
            transform: "translate(-50%, -50%)",
            padding: "0",
            border: "none",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            background: "transparent",
            width: "min(92vw, 42em)",
          },
          overlay: {
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 1000,
          },
        }}
        contentLabel={editing ? t("verification_files.edit") : t("verification_files.add")}
      >
        <FlatPanel className="relative flex max-h-[85vh] w-full flex-col items-stretch justify-start overflow-y-auto p-6">
          <p className="text-lg font-semibold t-primary">
            {editing ? t("verification_files.edit") : t("verification_files.add")}
          </p>

          <label className="mt-4 text-sm font-medium t-primary">{t("verification_files.path_label")}</label>
          <Input
            value={path}
            setValue={setPath}
            placeholder={t("verification_files.path_placeholder")}
            variant="flat"
            className="mt-2"
          />
          <p className="mt-1.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {t("verification_files.path_hint")}
          </p>

          <label className="mt-4 text-sm font-medium t-primary">{t("verification_files.content_label")}</label>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t("verification_files.content_placeholder")}
            className="mt-2 min-h-40 w-full rounded-xl border border-black/10 bg-w px-4 py-3 font-mono text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
          />

          <div className="mt-6 flex flex-row justify-end gap-3">
            <FlatActionButton
              onClick={() => setModalOpen(false)}
              className="text-neutral-500 dark:text-neutral-400"
            >
              {t("verification_files.cancel")}
            </FlatActionButton>
            <FlatActionButton onClick={save} className="t-primary">
              {saving ? t("verification_files.saving") : t("verification_files.save")}
            </FlatActionButton>
          </div>
        </FlatPanel>
      </Modal>
    </div>
  );
}