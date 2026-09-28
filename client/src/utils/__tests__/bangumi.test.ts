import { describe, expect, it } from "bun:test";
import {
  BANGUMI_DEFAULT_COLUMNS,
  bangumiCoverSource,
  bangumiCoverSrc,
  bangumiGridClass,
  resolveBangumiColumns,
} from "../bangumi";

describe("resolveBangumiColumns", () => {
  it("accepts the offered column counts", () => {
    expect(resolveBangumiColumns(2)).toBe(2);
    expect(resolveBangumiColumns("5")).toBe(5);
  });

  it("falls back to 4 for missing or unsupported values", () => {
    expect(resolveBangumiColumns(undefined)).toBe(BANGUMI_DEFAULT_COLUMNS);
    expect(resolveBangumiColumns("")).toBe(BANGUMI_DEFAULT_COLUMNS);
    expect(resolveBangumiColumns("abc")).toBe(BANGUMI_DEFAULT_COLUMNS);
    expect(resolveBangumiColumns(9)).toBe(BANGUMI_DEFAULT_COLUMNS);
  });
});

describe("bangumiGridClass", () => {
  it("returns the responsive class set for the column count", () => {
    expect(bangumiGridClass(4)).toBe("sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4");
    expect(bangumiGridClass("bad")).toBe(bangumiGridClass(BANGUMI_DEFAULT_COLUMNS));
  });
});

describe("bangumiCoverSrc", () => {
  it("routes covers through the site API", () => {
    expect(bangumiCoverSrc("https://lain.bgm.tv/pic/cover/l/ab/cd/1.jpg")).toBe(
      "/api/bangumi/cover?src=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fl%2Fab%2Fcd%2F1.jpg",
    );
  });

  it("ignores blank sources", () => {
    expect(bangumiCoverSrc("")).toBeUndefined();
    expect(bangumiCoverSrc(null)).toBeUndefined();
    expect(bangumiCoverSrc(undefined)).toBeUndefined();
  });
});

describe("bangumiCoverSource", () => {
  it("prefers the largest available image", () => {
    expect(
      bangumiCoverSource({ large: "l", common: "c", medium: "m" }),
    ).toBe("l");
    expect(bangumiCoverSource({ common: "", medium: "m" })).toBe("m");
  });

  it("returns undefined when no image is available", () => {
    expect(bangumiCoverSource(null)).toBeUndefined();
    expect(bangumiCoverSource({})).toBeUndefined();
  });
});
