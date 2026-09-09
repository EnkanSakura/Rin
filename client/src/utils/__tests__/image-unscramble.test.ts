import { describe, expect, it } from "bun:test";
import { blockCopies } from "../image-unscramble";

describe("blockCopies", () => {
  it("maps a permutation onto pixel rectangles", () => {
    // Block 1 sits at column 0 / row 1 (column-major index), block 0 at the origin.
    expect(blockCopies([1, 0], 40, 40)).toEqual([
      { sx: 0, sy: 10, dx: 0, dy: 0, width: 10, height: 10 },
      { sx: 0, sy: 0, dx: 0, dy: 10, width: 10, height: 10 },
    ]);
  });

  it("follows the championcross row/column convention", () => {
    // Reference algorithm: source column = index // 4, source row = index % 4.
    const copies = blockCopies([8, 6], 40, 40);
    expect(copies[0]).toEqual({ sx: 20, sy: 0, dx: 0, dy: 0, width: 10, height: 10 });
    expect(copies[1]).toEqual({ sx: 10, sy: 20, dx: 0, dy: 10, width: 10, height: 10 });
  });

  it("ignores out of range sources", () => {
    expect(blockCopies([99], 40, 40)).toEqual([]);
    expect(blockCopies([-1], 40, 40)).toEqual([]);
  });

  it("returns nothing when the image is smaller than the grid", () => {
    expect(blockCopies([0, 1], 3, 3)).toEqual([]);
    expect(blockCopies([0, 1], 0, 0)).toEqual([]);
  });

  it("produces one copy per scramble entry", () => {
    const scramble = [8, 6, 5, 0, 7, 15, 3, 11, 12, 2, 9, 4, 10, 14, 1, 13];
    expect(blockCopies(scramble, 1200, 800)).toHaveLength(16);
  });
});
