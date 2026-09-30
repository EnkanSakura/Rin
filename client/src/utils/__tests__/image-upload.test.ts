import { describe, expect, it } from "bun:test";
import {
  buildStorageThumbnailUrl,
  clampImageResizePercent,
  formatImageSize,
  imageNameFromKey,
  scaleImageUrl,
} from "../image-upload";

describe("clampImageResizePercent", () => {
  it("keeps valid percentages and clamps the rest", () => {
    expect(clampImageResizePercent(50)).toBe(50);
    expect(clampImageResizePercent(0.4)).toBe(1);
    expect(clampImageResizePercent(9999)).toBe(400);
    expect(clampImageResizePercent(Number.NaN)).toBe(100);
  });
});

describe("scaleImageUrl", () => {
  it("scales the width/height metadata and keeps the blurhash", () => {
    const url = "https://example.com/a.png#blurhash=abc&width=1000&height=500";
    expect(scaleImageUrl(url, 50)).toBe(
      "https://example.com/a.png#blurhash=abc&width=500&height=250",
    );
    expect(scaleImageUrl(url, 25)).toBe(
      "https://example.com/a.png#blurhash=abc&width=250&height=125",
    );
    expect(scaleImageUrl(url, 100)).toBe(url);
  });

  it("never produces a zero size", () => {
    expect(scaleImageUrl("https://example.com/a.png#width=10&height=10", 1)).toBe(
      "https://example.com/a.png#width=1&height=1",
    );
  });

  it("fills in measured dimensions for images without metadata", () => {
    expect(scaleImageUrl("https://example.com/a.png", 100, { width: 1000, height: 500 })).toBe(
      "https://example.com/a.png#width=1000&height=500",
    );
    expect(
      scaleImageUrl("https://example.com/a.png", 25, { width: 1000, height: 500, blurhash: "bh" }),
    ).toBe("https://example.com/a.png#blurhash=bh&width=250&height=125");
  });

  it("leaves URLs untouched when no size is known", () => {
    expect(scaleImageUrl("https://example.com/a.png", 50)).toBe("https://example.com/a.png");
    expect(scaleImageUrl("https://example.com/a.png#blurhash=abc", 50)).toBe(
      "https://example.com/a.png#blurhash=abc",
    );
  });
});

describe("buildStorageThumbnailUrl", () => {
  it("points at the site Worker thumbnail route", () => {
    expect(buildStorageThumbnailUrl("images/a.webp")).toBe("/api/blob/thumb/images/a.webp?w=240");
    expect(buildStorageThumbnailUrl("images/a.webp", 100)).toBe("/api/blob/thumb/images/a.webp?w=100");
  });

  it("encodes every path segment", () => {
    expect(buildStorageThumbnailUrl("images/my photo 图.png")).toBe(
      "/api/blob/thumb/images/my%20photo%20%E5%9B%BE.png?w=240",
    );
  });
});

describe("formatImageSize", () => {
  it("formats byte counts", () => {
    expect(formatImageSize(0)).toBe("—");
    expect(formatImageSize(undefined)).toBe("—");
    expect(formatImageSize(512)).toBe("512 B");
    expect(formatImageSize(2048)).toBe("2.0 KB");
    expect(formatImageSize(15 * 1024)).toBe("15 KB");
  });
});

describe("imageNameFromKey", () => {
  it("returns the last path segment", () => {
    expect(imageNameFromKey("images/ab12.webp")).toBe("ab12.webp");
    expect(imageNameFromKey("ab12.png")).toBe("ab12.png");
  });
});
