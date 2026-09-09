import { describe, expect, it } from "bun:test";
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
} from "../lc";

describe("unit conversion", () => {
  it("converts inductance to henry", () => {
    expect(toInductance(1, "H")).toBe(1);
    expect(toInductance(10, "mH")).toBeCloseTo(0.01, 12);
    expect(toInductance(100, "uH")).toBeCloseTo(1e-4, 12);
    expect(toInductance(2.5, "nH")).toBeCloseTo(2.5e-9, 15);
  });

  it("converts capacitance to farad", () => {
    expect(toCapacitance(100, "pF")).toBeCloseTo(1e-10, 16);
    expect(toCapacitance(22, "nF")).toBeCloseTo(2.2e-8, 15);
    expect(toCapacitance(4.7, "uF")).toBeCloseTo(4.7e-6, 12);
  });

  it("converts frequency to hertz", () => {
    expect(toFrequency(1, "Hz")).toBe(1);
    expect(toFrequency(7.1, "MHz")).toBeCloseTo(7.1e6, 3);
    expect(toFrequency(2.4, "GHz")).toBeCloseTo(2.4e9, 0);
  });

  it("rejects unknown units", () => {
    expect(() => toInductance(1, "xH")).toThrow();
    expect(() => toCapacitance(1, "xF")).toThrow();
    expect(() => toFrequency(1, "THz")).toThrow();
  });
});

describe("resonanceFrequency", () => {
  it("matches the classic LC formula", () => {
    // 100 µH with 100 pF resonates at ~1.59 MHz
    const f = resonanceFrequency(100e-6, 100e-12);
    expect(f).toBeCloseTo(1_591_549, 0);
  });

  it("returns NaN for invalid inputs", () => {
    expect(Number.isNaN(resonanceFrequency(0, 1e-9))).toBe(true);
    expect(Number.isNaN(resonanceFrequency(1e-6, -1))).toBe(true);
  });
});

describe("inductanceFor / capacitanceFor", () => {
  it("round-trips with resonanceFrequency", () => {
    const L = 220e-6;
    const C = 47e-12;
    const f = resonanceFrequency(L, C);
    expect(inductanceFor(f, C)).toBeCloseTo(L, 12);
    expect(capacitanceFor(f, L)).toBeCloseTo(C, 15);
  });

  it("returns NaN for invalid inputs", () => {
    expect(Number.isNaN(inductanceFor(0, 1e-9))).toBe(true);
    expect(Number.isNaN(capacitanceFor(1e6, 0))).toBe(true);
  });
});

describe("matchedCapacitance", () => {
  it("scales capacitance with the square of the frequency ratio", () => {
    // Halving the target frequency quadruples the capacitance.
    expect(matchedCapacitance(100e-12, 10e6, 5e6)).toBeCloseTo(400e-12, 15);
    // Doubling the target frequency quarters the capacitance.
    expect(matchedCapacitance(100e-12, 10e6, 20e6)).toBeCloseTo(25e-12, 15);
    // Same frequency keeps the capacitance.
    expect(matchedCapacitance(100e-12, 7.1e6, 7.1e6)).toBeCloseTo(100e-12, 18);
  });

  it("returns NaN for invalid inputs", () => {
    expect(Number.isNaN(matchedCapacitance(0, 1e6, 2e6))).toBe(true);
    expect(Number.isNaN(matchedCapacitance(1e-12, 0, 2e6))).toBe(true);
    expect(Number.isNaN(matchedCapacitance(1e-12, 1e6, 0))).toBe(true);
  });
});

describe("engineering formatting", () => {
  it("picks a readable unit", () => {
    expect(formatCapacitance(1e-12).text).toBe("1 pF");
    expect(formatCapacitance(1e-9).text).toBe("1 nF");
    expect(formatCapacitance(1e-6).text).toBe("1 µF");
    expect(formatInductance(1e-6).text).toBe("1 µH");
    expect(formatFrequency(1.591549e6).text).toBe("1.59155 MHz");
    expect(formatFrequency(1500).text).toBe("1.5 kHz");
  });

  it("handles zero and non-finite values", () => {
    expect(formatCapacitance(0).text).toBe("0 F");
    expect(formatFrequency(Number.NaN).text).toBe("—");
  });

  it("keeps the unit tables ordered from largest to smallest", () => {
    const factors = (units: typeof INDUCTANCE_UNITS) => units.map((unit) => unit.factor);
    expect(factors(INDUCTANCE_UNITS)).toEqual([1, 1e-3, 1e-6, 1e-9, 1e-12]);
    expect(factors(CAPACITANCE_UNITS)).toEqual([1, 1e-3, 1e-6, 1e-9, 1e-12]);
    expect(factors(FREQUENCY_UNITS)).toEqual([1, 1e3, 1e6, 1e9]);
  });
});

describe("parseNumberInput", () => {
  it("parses plain and messy numbers", () => {
    expect(parseNumberInput("100")).toBe(100);
    expect(parseNumberInput("1,000")).toBe(1000);
    expect(parseNumberInput(" 4.7 ")).toBe(4.7);
    expect(parseNumberInput("１００")).toBe(100);
    expect(parseNumberInput("1e3")).toBe(1000);
  });

  it("returns NaN for empty or invalid input", () => {
    expect(Number.isNaN(parseNumberInput(""))).toBe(true);
    expect(Number.isNaN(parseNumberInput("abc"))).toBe(true);
  });
});
