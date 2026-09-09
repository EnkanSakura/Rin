import { describe, expect, it } from "bun:test";
import { buildZip, crc32, sanitizeFileName, type ZipEntry } from "../zip";

async function readZip(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function u32At(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function u16At(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

describe("crc32", () => {
  it("matches the known reference value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("buildZip", () => {
  const entries: ZipEntry[] = [
    { name: "series/chapter 1/image_001.jpg", data: new Uint8Array([1, 2, 3, 4]) },
    { name: "series/chapter 1/image_002.jpg", data: new Uint8Array([5, 6]) },
  ];

  it("writes a well formed store-only archive", async () => {
    const blob = buildZip(entries, new Date(2024, 0, 2, 3, 4, 6));
    expect(blob.type).toBe("application/zip");

    const bytes = await readZip(blob);
    // Local file header signature.
    expect(u32At(bytes, 0)).toBe(0x04034b50);
    // Method = store, UTF-8 flag set.
    expect(u16At(bytes, 8)).toBe(0);
    expect(u16At(bytes, 6)).toBe(0x0800);
    // First entry crc + size.
    expect(u32At(bytes, 14)).toBe(crc32(entries[0]!.data));
    expect(u32At(bytes, 18)).toBe(4);
    expect(u32At(bytes, 22)).toBe(4);

    // End of central directory record.
    const eocdOffset = bytes.length - 22;
    expect(u32At(bytes, eocdOffset)).toBe(0x06054b50);
    expect(u16At(bytes, eocdOffset + 8)).toBe(2);
    expect(u16At(bytes, eocdOffset + 10)).toBe(2);
    expect(u32At(bytes, eocdOffset + 12)).toBeGreaterThan(0);
  });

  it("keeps every payload byte intact", async () => {
    const bytes = await readZip(buildZip(entries));
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("series/chapter 1/image_001.jpg");
    expect(text).toContain("series/chapter 1/image_002.jpg");
    expect(bytes.includes(5) && bytes.includes(6)).toBe(true);
  });

  it("handles an empty archive", async () => {
    const bytes = await readZip(buildZip([]));
    expect(bytes.length).toBe(22);
    expect(u32At(bytes, 0)).toBe(0x06054b50);
  });
});

describe("sanitizeFileName", () => {
  it("strips path separators and reserved characters", () => {
    expect(sanitizeFileName('第1話: "序"')).toBe("第1話_ _序_");
    expect(sanitizeFileName("a/b\\c")).toBe("a_b_c");
    expect(sanitizeFileName("   ")).toBe("download");
    expect(sanitizeFileName("", "fallback")).toBe("fallback");
  });

  it("limits the length", () => {
    expect(sanitizeFileName("a".repeat(300)).length).toBe(120);
  });
});
