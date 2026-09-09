import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CAPACITANCE_UNITS,
  FREQUENCY_UNITS,
  INDUCTANCE_UNITS,
  capacitanceFor,
  formatCapacitance,
  formatFrequency,
  formatInductance,
  inductanceFor,
  matchedCapacitance,
  parseNumberInput,
  resonanceFrequency,
  toCapacitance,
  toFrequency,
  toInductance,
  type UnitOption,
} from "../../utils/lc";
import { ToolCard, ToolField, ToolShell } from "./tool-shell";

type Quantity = "l" | "c" | "f";

const QUANTITIES: Quantity[] = ["l", "c", "f"];

function NumberUnitInput({
  value,
  unit,
  units,
  onValueChange,
  onUnitChange,
}: {
  value: string;
  unit: string;
  units: UnitOption[];
  onValueChange: (value: string) => void;
  onUnitChange: (unit: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        inputMode="decimal"
        onChange={(event) => onValueChange(event.target.value)}
        className="min-w-0 flex-1 rounded-xl border border-black/10 bg-w px-4 py-2 font-mono t-primary transition-colors focus:border-black/20 focus:outline-none focus:ring-2 focus:ring-theme/10 dark:border-white/10"
      />
      <select
        value={unit}
        onChange={(event) => onUnitChange(event.target.value)}
        className="w-24 shrink-0 rounded-xl border border-black/10 bg-w px-2 py-2 t-primary focus:outline-none focus:ring-2 focus:ring-theme/10 dark:border-white/10"
      >
        {units.map((option) => (
          <option key={option.unit} value={option.unit}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ResultValue({ text, label }: { text: string; label: string }) {
  return (
    <div className="rounded-xl bg-theme/10 px-4 py-3">
      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-0.5 break-all font-mono text-2xl font-bold text-theme">{text}</div>
    </div>
  );
}

interface QuantityState {
  value: string;
  unit: string;
}

function ResonanceCalculator() {
  const { t } = useTranslation();
  // Inputs start empty: no placeholder text and no example values.
  const [l, setL] = useState<QuantityState>({ value: "", unit: "uH" });
  const [c, setC] = useState<QuantityState>({ value: "", unit: "pF" });
  const [f, setF] = useState<QuantityState>({ value: "", unit: "MHz" });

  const states: Record<Quantity, QuantityState> = { l, c, f };
  const setters: Record<Quantity, (next: QuantityState) => void> = { l: setL, c: setC, f: setF };

  const labels: Record<Quantity, string> = {
    l: t("tools.lc_calculator.inductance"),
    c: t("tools.lc_calculator.capacitance"),
    f: t("tools.lc_calculator.frequency"),
  };

  const resultLabels: Record<Quantity, string> = {
    l: t("tools.lc_calculator.result_l"),
    c: t("tools.lc_calculator.result_c"),
    f: t("tools.lc_calculator.result_f"),
  };

  const parsed = useMemo(
    () => ({
      l: toInductance(parseNumberInput(l.value), l.unit),
      c: toCapacitance(parseNumberInput(c.value), c.unit),
      f: toFrequency(parseNumberInput(f.value), f.unit),
    }),
    [l.value, l.unit, c.value, c.unit, f.value, f.unit],
  );

  const filled = useMemo(
    () => QUANTITIES.filter((quantity) => Number.isFinite(parsed[quantity]) && parsed[quantity] > 0),
    [parsed],
  );

  const result = useMemo<{ kind: Quantity; base: number } | null>(() => {
    if (filled.length !== 2) {
      return null;
    }
    const missing = QUANTITIES.find((quantity) => !filled.includes(quantity))!;
    if (missing === "f") {
      return { kind: "f", base: resonanceFrequency(parsed.l, parsed.c) };
    }
    if (missing === "l") {
      return { kind: "l", base: inductanceFor(parsed.f, parsed.c) };
    }
    return { kind: "c", base: capacitanceFor(parsed.f, parsed.l) };
  }, [filled, parsed]);

  const resultText = useMemo(() => {
    if (!result) {
      return "";
    }
    if (result.kind === "f") {
      return formatFrequency(result.base).text;
    }
    if (result.kind === "l") {
      return formatInductance(result.base).text;
    }
    return formatCapacitance(result.base).text;
  }, [result]);

  /** Moves the computed value into its input and clears the two known values. */
  const applyResult = () => {
    if (!result) {
      return;
    }
    const formatted =
      result.kind === "f"
        ? formatFrequency(result.base)
        : result.kind === "l"
          ? formatInductance(result.base)
          : formatCapacitance(result.base);

    const nextValue = Number.isFinite(formatted.value) ? String(Number(formatted.value.toPrecision(6))) : "";
    const nextUnit = formatted.unit;

    for (const quantity of QUANTITIES) {
      if (quantity === result.kind) {
        setters[quantity]({ value: nextValue, unit: nextUnit });
      } else {
        setters[quantity]({ value: "", unit: states[quantity].unit });
      }
    }
  };

  return (
    <ToolCard className="space-y-4">
      <div>
        <h2 className="text-base font-semibold t-primary">{t("tools.lc_calculator.resonance_title")}</h2>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          {t("tools.lc_calculator.resonance_desc")}
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <ToolField label={labels.l} className="min-w-0 flex-1">
          <NumberUnitInput
            value={l.value}
            unit={l.unit}
            units={INDUCTANCE_UNITS}
            onValueChange={(value) => setL({ ...l, value })}
            onUnitChange={(unit) => setL({ ...l, unit })}
          />
        </ToolField>

        <ToolField label={labels.c} className="min-w-0 flex-1">
          <NumberUnitInput
            value={c.value}
            unit={c.unit}
            units={CAPACITANCE_UNITS}
            onValueChange={(value) => setC({ ...c, value })}
            onUnitChange={(unit) => setC({ ...c, unit })}
          />
        </ToolField>

        <ToolField label={labels.f} className="min-w-0 flex-1">
          <NumberUnitInput
            value={f.value}
            unit={f.unit}
            units={FREQUENCY_UNITS}
            onValueChange={(value) => setF({ ...f, value })}
            onUnitChange={(unit) => setF({ ...f, unit })}
          />
        </ToolField>

        <button
          type="button"
          onClick={applyResult}
          disabled={!result}
          title={t("tools.lc_calculator.recalc_hint")}
          className="inline-flex h-min shrink-0 items-center justify-center gap-2 rounded-xl bg-theme px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <i className="ri-refresh-line" aria-hidden="true" />
          {t("tools.lc_calculator.recalc")}
        </button>
      </div>

      {result ? <ResultValue label={resultLabels[result.kind]} text={resultText} /> : null}
    </ToolCard>
  );
}

function MatchingCalculator() {
  const { t } = useTranslation();
  // Inputs start empty: no placeholder text and no example values.
  const [c, setC] = useState<QuantityState>({ value: "", unit: "pF" });
  const [from, setFrom] = useState<QuantityState>({ value: "", unit: "MHz" });
  const [to, setTo] = useState<QuantityState>({ value: "", unit: "MHz" });

  const result = useMemo(() => {
    const capacitance = toCapacitance(parseNumberInput(c.value), c.unit);
    const currentFrequency = toFrequency(parseNumberInput(from.value), from.unit);
    const targetFrequency = toFrequency(parseNumberInput(to.value), to.unit);
    if (!(capacitance > 0) || !(currentFrequency > 0) || !(targetFrequency > 0)) {
      return null;
    }
    return matchedCapacitance(capacitance, currentFrequency, targetFrequency);
  }, [c.value, c.unit, from.value, from.unit, to.value, to.unit]);

  return (
    <ToolCard className="space-y-4">
      <div>
        <h2 className="text-base font-semibold t-primary">{t("tools.lc_calculator.matching_title")}</h2>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          {t("tools.lc_calculator.matching_desc")}
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <ToolField label={t("tools.lc_calculator.current_c")} className="min-w-0 flex-1">
          <NumberUnitInput
            value={c.value}
            unit={c.unit}
            units={CAPACITANCE_UNITS}
            onValueChange={(value) => setC({ ...c, value })}
            onUnitChange={(unit) => setC({ ...c, unit })}
          />
        </ToolField>

        <ToolField label={t("tools.lc_calculator.current_f")} className="min-w-0 flex-1">
          <NumberUnitInput
            value={from.value}
            unit={from.unit}
            units={FREQUENCY_UNITS}
            onValueChange={(value) => setFrom({ ...from, value })}
            onUnitChange={(unit) => setFrom({ ...from, unit })}
          />
        </ToolField>

        <ToolField label={t("tools.lc_calculator.target_f")} className="min-w-0 flex-1">
          <NumberUnitInput
            value={to.value}
            unit={to.unit}
            units={FREQUENCY_UNITS}
            onValueChange={(value) => setTo({ ...to, value })}
            onUnitChange={(unit) => setTo({ ...to, unit })}
          />
        </ToolField>
      </div>

      {result !== null ? (
        <ResultValue label={t("tools.lc_calculator.result_target_c")} text={formatCapacitance(result).text} />
      ) : null}
    </ToolCard>
  );
}

export function LcCalculatorPage() {
  return (
    <ToolShell
      titleKey="tools.lc_calculator.title"
      descriptionKey="tools.lc_calculator.desc"
      icon="ri-equalizer-2-line"
    >
      <div className="space-y-4">
        <ResonanceCalculator />
        <MatchingCalculator />
      </div>
    </ToolShell>
  );
}
