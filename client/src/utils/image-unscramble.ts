/**
 * Undo Champion Cross' 4x4 page scramble in the browser.
 *
 * The reader api returns each page together with a `scramble` permutation: the
 * source image is cut into a 4x4 grid and the block at position
 * `scramble[i]` belongs at destination position `i` (same order the reference
 * python downloader uses).
 */

export interface BlockCopy {
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
}

/** Pure geometry of the unscramble step; exported for tests. */
export function blockCopies(
  scramble: number[],
  width: number,
  height: number,
  columns = 4,
  rows = 4,
): BlockCopy[] {
  const blockWidth = Math.floor(width / columns);
  const blockHeight = Math.floor(height / rows);
  if (blockWidth <= 0 || blockHeight <= 0) {
    return [];
  }

  const copies: BlockCopy[] = [];
  for (let index = 0; index < scramble.length; index += 1) {
    const source = scramble[index];
    if (source === undefined || source < 0 || source >= columns * rows) {
      continue;
    }
    const sourceCol = Math.floor(source / columns);
    const sourceRow = source % columns;
    const targetCol = Math.floor(index / columns);
    const targetRow = index % columns;
    copies.push({
      sx: sourceCol * blockWidth,
      sy: sourceRow * blockHeight,
      dx: targetCol * blockWidth,
      dy: targetRow * blockHeight,
      width: blockWidth,
      height: blockHeight,
    });
  }
  return copies;
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas 2d context is unavailable");
  }
  return { canvas, ctx };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob failed"))),
      type,
      quality,
    );
  });
}

export interface UnscrambledPage {
  blob: Blob;
  extension: string;
}

function extensionForType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

/**
 * Rebuilds one page. Unscrambled pages are returned untouched (no needless
 * re-encoding); scrambled pages are re-composited and re-encoded as JPEG.
 */
export async function unscramblePage(
  blob: Blob,
  scramble: number[] | null,
  quality = 0.92,
): Promise<UnscrambledPage> {
  if (!scramble || scramble.length === 0) {
    return { blob, extension: extensionForType(blob.type) };
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const { canvas, ctx } = createCanvas(width, height);

    // Keep the untouched border pixels (width/height are not always divisible
    // by four) and only overwrite the 4x4 block area below.
    ctx.drawImage(bitmap, 0, 0);

    const { canvas: sourceCanvas, ctx: sourceCtx } = createCanvas(width, height);
    sourceCtx.drawImage(bitmap, 0, 0);

    for (const copy of blockCopies(scramble, width, height)) {
      ctx.drawImage(
        sourceCanvas,
        copy.sx,
        copy.sy,
        copy.width,
        copy.height,
        copy.dx,
        copy.dy,
        copy.width,
        copy.height,
      );
    }

    const output = await canvasToBlob(canvas, "image/jpeg", quality);
    return { blob: output, extension: "jpg" };
  } finally {
    bitmap.close?.();
  }
}
