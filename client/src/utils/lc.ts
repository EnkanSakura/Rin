/**
 * LC resonance helpers.
 *
 * The resonant frequency of an ideal LC tank is
 *
 *     f = 1 / (2 * PI * sqrt(L * C))
 *
 * All exported functions work on SI base units (henry, farad, hertz); the unit
 * helpers convert to and from the display units used by the calculator page.
 */

export type Unit = "H" | "mH" | "uH" | "nH" | "pH";

export interface UnitOption<U extends string = string> {
  unit: U;
  label: string;
  factor: number;
}

export const INDUCTANCE_UNITS: UnitOption[] = [
  { unit: "H", label: "H", factor: 1 },
  { unit: "mH", label: "mH", factor: 1e-3 },
  { unit: "uH", label: "µH", factor: 1e-6 },
  { unit: "nH", label: "nH", factor: 1e-9 },
  { unit: "pH", label: "pH", factor: 1e-12 },
];

export const CAPACITANCE_UNITS: UnitOption[] = [
  { unit: "F", label: "F", factor: 1 },
  { unit: "mF", label: "mF", factor: 1e-3 },
  { unit: "uF", label: "µF", factor: 1e-6 },
  { unit: "nF", label: "nF", factor: 1e-9 },
  { unit: "pF", label: "pF", factor: 1e-12 },
];

export const FREQUENCY_UNITS: UnitOption[] = [
  { unit: "Hz", label: "Hz", factor: 1 },
  { unit: "kHz", label: "kHz", factor: 1e3 },
  { unit: "MHz", label: "MHz", factor: 1e6 },
  { unit: "GHz", label: "GHz", factor: 1e9 },
];

function factorOf(options: UnitOption[], unit: string): number {
  const match = options.find((option) => option.unit === unit);
  if (!match) {
    throw new Error(`unknown unit: ${unit}`);
  }
  return match.factor;
}

/** Converts a display value into SI base units. */
export function toBase(value: number, unit: string, options: UnitOption[]): number {
  return value * factorOf(options, unit);
}

/** Converts a SI base value into the requested display unit. */
export function fromBase(value: number, unit: string, options: UnitOption[]): number {
  return value / factorOf(options, unit);
}

export function toInductance(value: number, unit: string): number {
  return toBase(value, unit, INDUCTANCE_UNITS);
}

export function toCapacitance(value: number, unit: string): number {
  return toBase(value, unit, CAPACITANCE_UNITS);
}

export function toFrequency(value: number, unit: string): number {
  return toBase(value, unit, FREQUENCY_UNITS);
}

/** f = 1 / (2π√(LC)), L in henry, C in farad, result in hertz. */
export function resonanceFrequency(inductance: number, capacitance: number): number {
  if (inductance <= 0 || capacitance <= 0) {
    return Number.NaN;
  }
  return 1 / (2 * Math.PI * Math.sqrt(inductance * capacitance));
}

/** L = 1 / ((2πf)² C) */
export function inductanceFor(frequency: number, capacitance: number): number {
  if (frequency <= 0 || capacitance <= 0) {
    return Number.NaN;
  }
  return 1 / (Math.pow(2 * Math.PI * frequency, 2) * capacitance);
}

/** C = 1 / ((2πf)² L) */
export function capacitanceFor(frequency: number, inductance: number): number {
  if (frequency <= 0 || inductance <= 0) {
    return Number.NaN;
  }
  return 1 / (Math.pow(2 * Math.PI * frequency, 2) * inductance);
}

/**
 * Frequency matching: scaling the capacitance of an LC tank scales its
 * resonant frequency with 1/√C, so
 *
 *     C_target = C_current * (f_current / f_target)²
 */
export function matchedCapacitance(
  currentCapacitance: number,
  currentFrequency: number,
  targetFrequency: number,
): number {
  if (currentCapacitance <= 0 || currentFrequency <= 0 || targetFrequency <= 0) {
    return Number.NaN;
  }
  return currentCapacitance * Math.pow(currentFrequency / targetFrequency, 2);
}

export interface EngineeringValue {
  value: number;
  unit: string;
  /** e.g. "12.34 nF" */
  text: string;
}

/**
 * Picks the friendliest display unit for a SI base value: the mantissa lands in
 * [1, 1000) whenever the magnitude allows it.
 */
export function toEngineering(value: number, options: UnitOption[], precision = 6): EngineeringValue {
  if (!Number.isFinite(value) || value === 0) {
    return { value, unit: options[0]?.unit ?? "", text: Number.isFinite(value) ? `0 ${options[0]?.unit ?? ""}` : "—" };
  }

  const magnitude = Math.abs(value);
  const eligible = options.filter((option) => magnitude >= option.factor);
  const chosen = eligible.length
    ? eligible.reduce((best, option) => (option.factor > best.factor ? option : best))
    : options[options.length - 1];
  if (!chosen) {
    return { value, unit: "", text: "—" };
  }

  const scaled = value / chosen.factor;
  const text = `${Number(scaled.toPrecision(precision))} ${chosen.label}`;
  return { value: scaled, unit: chosen.unit, text };
}

export function formatInductance(value: number): EngineeringValue {
  return toEngineering(value, INDUCTANCE_UNITS);
}

export function formatCapacitance(value: number): EngineeringValue {
  return toEngineering(value, CAPACITANCE_UNITS);
}

export function formatFrequency(value: number): EngineeringValue {
  return toEngineering(value, FREQUENCY_UNITS);
}

/** Parses user input, tolerating commas and full-width characters. */
export function parseNumberInput(input: string): number {
  const cleaned = (input ?? "")
    .replace(/[，,\s]/g, "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".")
    .replace(/[－ー]/g, "-");
  if (!cleaned) {
    return Number.NaN;
  }
  return Number(cleaned);
}
