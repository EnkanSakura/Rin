import { describe, expect, it } from "bun:test";
import {
  buildThumbnailUrl,
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

describe("buildThumbnailUrl", () => {
  it("builds a Cloudflare resizing URL for relative storage paths", () => {
    expect(buildThumbnailUrl("/api/blob/images/a.png", 240, "https://blog.test")).toBe(
      "/cdn-cgi/image/width=240,fit=scale-down,quality=75/https://blog.test/api/blob/images/a.png",
    );
  });

  it("keeps absolute image URLs and drops the metadata fragment", () => {
    expect(buildThumbnailUrl("https://cdn.test/a.png#width=100&height=50", 100, "https://blog.test")).toBe(
      "/cdn-cgi/image/width=100,fit=scale-down,quality=75/https://cdn.test/a.png",
    );
  });

  it("returns the source when no origin is available", () => {
    expect(buildThumbnailUrl("/api/blob/a.png", 240, "")).toBe("/api/blob/a.png");
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
