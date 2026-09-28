import { useTranslation } from "react-i18next";
import { BANGUMI_COLUMN_OPTIONS, resolveBangumiColumns } from "../utils/bangumi";
import { ItemDraggableChecklist, ItemInput, ItemSelect, type ChecklistOption } from "./settings-items";

const BANGUMI_CATEGORY_DEFS = [
  { id: "anime", labelKey: "bangumi.category.anime" },
  { id: "book", labelKey: "bangumi.category.book" },
  { id: "music", labelKey: "bangumi.category.music" },
  { id: "game", labelKey: "bangumi.category.game" },
  { id: "reality", labelKey: "bangumi.category.reality" },
] as const;

const BANGUMI_UPDATE_MODE_VALUES = ["realtime", "auto"] as const;

export function BangumiSettings({
  userId,
  userAgent,
  apiUrl,
  subjectBaseUrl,
  categoryOrder,
  updateMode,
  columns,
  onChange,
}: {
  userId: string;
  userAgent: string;
  apiUrl: string;
  subjectBaseUrl: string;
  categoryOrder: string;
  updateMode: string;
  columns: string;
  onChange: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation();

  const categoryOptions: ChecklistOption[] = BANGUMI_CATEGORY_DEFS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
  }));

  const updateModeValue = BANGUMI_UPDATE_MODE_VALUES.includes(updateMode as (typeof BANGUMI_UPDATE_MODE_VALUES)[number])
    ? updateMode
    : "realtime";

  const columnValue = String(resolveBangumiColumns(columns));

  return (
    <>
      <ItemSelect
        title={t("settings.bangumi.update_mode.title")}
        description={t("settings.bangumi.update_mode.desc")}
        value={updateModeValue}
        onChange={(value) => {
          onChange("bangumi.updateMode", value);
        }}
        options={BANGUMI_UPDATE_MODE_VALUES.map((value) => ({
          value,
          label: t(`settings.bangumi.update_mode.options.${value}`),
        }))}
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
      <ItemSelect
        title={t("settings.bangumi.columns.title")}
        description={t("settings.bangumi.columns.desc")}
        value={columnValue}
        onChange={(value) => {
          onChange("bangumi.columns", Number(value));
        }}
        options={BANGUMI_COLUMN_OPTIONS.map((num) => ({
          value: String(num),
          label: t("settings.bangumi.columns.option$num", { num }),
        }))}
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
