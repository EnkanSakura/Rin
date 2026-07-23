import { useTranslation } from "react-i18next";
import { ItemInput, ItemSwitch, ItemDraggableChecklist, type ChecklistOption } from "./settings-items";

const BANGUMI_CATEGORY_DEFS = [
  { id: "anime", labelKey: "bangumi.category.anime" },
  { id: "book", labelKey: "bangumi.category.book" },
  { id: "music", labelKey: "bangumi.category.music" },
  { id: "game", labelKey: "bangumi.category.game" },
  { id: "reality", labelKey: "bangumi.category.reality" },
] as const;

export function BangumiSettings({
  userId,
  userAgent,
  apiUrl,
  subjectBaseUrl,
  enabled,
  categoryOrder,
  onChange,
}: {
  userId: string;
  userAgent: string;
  apiUrl: string;
  subjectBaseUrl: string;
  enabled: boolean;
  categoryOrder: string;
  onChange: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();

  const categoryOptions: ChecklistOption[] = BANGUMI_CATEGORY_DEFS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
  }));

  return (
    <>
      <ItemSwitch
        title={t("settings.bangumi.enable.title")}
        description={t("settings.bangumi.enable.desc")}
        checked={enabled}
        onChange={(checked) => {
          onChange("bangumi.enabled", checked);
        }}
      />
      <ItemInput
        title={t("settings.bangumi.user_id.title")}
        description={t("settings.bangumi.user_id.desc")}
        configKeyTitle="User ID"
        value={userId}
        placeholder="123456"
        onChange={(value) => {
          onChange("bangumi.userId", value);
        }}
      />
      <ItemInput
        title={t("settings.bangumi.user_agent.title")}
        description={t("settings.bangumi.user_agent.desc")}
        configKeyTitle="User-Agent"
        value={userAgent}
        placeholder="Rin-Bangumi/1.0"
        onChange={(value) => {
          onChange("bangumi.userAgent", value);
        }}
      />
      <ItemInput
        title={t("settings.bangumi.api_url.title")}
        description={t("settings.bangumi.api_url.desc")}
        configKeyTitle="API URL"
        value={apiUrl}
        placeholder="https://api.bgm.tv"
        onChange={(value) => {
          onChange("bangumi.apiUrl", value);
        }}
      />
      <ItemInput
        title={t("settings.bangumi.subject_base_url.title")}
        description={t("settings.bangumi.subject_base_url.desc")}
        configKeyTitle={t("settings.bangumi.subject_base_url.label")}
        value={subjectBaseUrl}
        placeholder="https://bgm.tv/subject/"
        onChange={(value) => {
          onChange("bangumi.subjectBaseUrl", value);
        }}
      />
      <ItemDraggableChecklist
        title={t("settings.bangumi.categories.title")}
        description={t("settings.bangumi.categories.desc")}
        allOptions={categoryOptions}
        value={categoryOrder}
        onChange={(value) => {
          onChange("bangumi.categoryOrder", value);
        }}
      />
    </>
  );
}
