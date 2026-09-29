import "../../test/setup";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";
import {
  ImageInsertDialog,
  type ImageInsertDialogProps,
  type InsertImagePayload,
  type PickedImage,
} from "../image-insert-dialog";

mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function MockModal({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
Object.assign(MockModal, { setAppElement: () => {} });

mock.module("react-modal", () => ({ default: MockModal }));

const EXISTING = [
  {
    key: "images/a.webp",
    url: "https://img.test/api/blob/images/a.webp",
    size: 2048,
    uploadedAt: "2025-06-01T00:00:00.000Z",
  },
  {
    key: "images/b.png",
    url: "https://img.test/api/blob/images/b.png",
    size: 4096,
    uploadedAt: "2025-05-01T00:00:00.000Z",
  },
];

type DialogMocks = {
  onInsert: ReturnType<typeof mock>;
  onClose: ReturnType<typeof mock>;
  onError: ReturnType<typeof mock>;
  listImages: ReturnType<typeof mock>;
  uploadImage: ReturnType<typeof mock>;
  measureImage: ReturnType<typeof mock>;
};

function renderDialog(overrides: Partial<ImageInsertDialogProps> = {}) {
  const onInsert = mock((_payload: InsertImagePayload) => {});
  const onClose = mock(() => {});
  const onError = mock((_message: string) => {});
  const listImages = mock(async () => ({
    items: EXISTING,
    cursor: null,
    total: EXISTING.length,
  }));
  const uploadImage = mock(
    async (file: File): Promise<PickedImage> => ({
      url: "https://img.test/api/blob/images/new.webp#blurhash=bh&width=1200&height=800",
      name: file.name,
      size: file.size,
      width: 1200,
      height: 800,
      blurhash: "bh",
    }),
  );
  const measureImage = mock(async () => ({ width: 1000, height: 500, blurhash: "bh2" }));

  const view = render(
    <ImageInsertDialog
      isOpen
      onClose={onClose}
      onInsert={onInsert}
      onError={onError}
      listImages={listImages}
      uploadImage={uploadImage}
      measureImage={measureImage}
      pageSize={10}
      {...overrides}
    />,
  );

  return { ...view, onInsert, onClose, onError, listImages, uploadImage, measureImage } as
    typeof view & DialogMocks;
}

function uploadFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(() => {
  cleanup();
});

describe("ImageInsertDialog", () => {
  it("opens on the new tab without loading existing images", () => {
    const { container, getByText, listImages } = renderDialog();

    expect(getByText("upload.image.dialog.new_hint")).toBeDefined();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(listImages).not.toHaveBeenCalled();
  });

  it("lists stored images, shows their url and size, and scales them by percentage", async () => {
    const { container, getByLabelText, getByText, onInsert, onClose, listImages, measureImage } =
      renderDialog();

    fireEvent.click(getByText("upload.image.dialog.tab_existing"));
    await waitFor(() => {
      expect(listImages).toHaveBeenCalledTimes(1);
    });

    const first = await waitFor(() => {
      const node = container.querySelector('[title="images/a.webp"]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    fireEvent.click(first);

    await waitFor(() => {
      expect(measureImage).toHaveBeenCalledWith(EXISTING[0]!.url);
      expect(container.textContent).toContain("1000 × 500");
    });
    // Full url, file name and both sizes are shown next to the preview.
    expect(container.textContent).toContain(EXISTING[0]!.url);
    expect(container.textContent).toContain("a.webp");

    const percentInput = getByLabelText("upload.image.dialog.scale_label") as HTMLInputElement;
    // React installs a value tracker on the node, so a plain assignment is seen
    // as "no change"; go through the prototype setter and dispatch like a user.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    nativeValueSetter.call(percentInput, "50");
    percentInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await waitFor(() => {
      expect(container.textContent).toContain("500 × 250");
    });

    fireEvent.click(getByText("upload.image.dialog.insert"));

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0]![0]).toEqual({
      url: "https://img.test/api/blob/images/a.webp#blurhash=bh2&width=500&height=250",
      name: "a.webp",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uploads a local file and inserts the url scaled by the chosen percentage", async () => {
    const { container, getByText, onInsert, uploadImage } = renderDialog();

    uploadFile(container, new File(["x"], "photo.png", { type: "image/png" }));

    await waitFor(() => {
      expect(uploadImage).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("1200 × 800");
    });

    fireEvent.click(getByText("25%"));
    expect(container.textContent).toContain("300 × 200");

    fireEvent.click(getByText("upload.image.dialog.insert"));
    expect(onInsert.mock.calls[0]![0]).toEqual({
      url: "https://img.test/api/blob/images/new.webp#blurhash=bh&width=300&height=200",
      name: "photo.png",
    });
  });

  it("reports upload errors and keeps the insert button disabled", async () => {
    const uploadImage = mock(async () => {
      throw new Error("boom");
    });
    const { container, getByText, onInsert, onError } = renderDialog({ uploadImage });

    const insertButton = getByText("upload.image.dialog.insert");
    expect((insertButton as HTMLButtonElement).disabled).toBe(true);

    uploadFile(container, new File(["x"], "photo.png", { type: "image/png" }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("boom");
    });
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("falls back to the original image when the thumbnail cannot be resized", async () => {
    const { container, getByText } = renderDialog();
    fireEvent.click(getByText("upload.image.dialog.tab_existing"));

    const thumb = (await waitFor(() => {
      const node = container.querySelector('img[alt="a.webp"]');
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    })) as HTMLImageElement;

    expect(thumb.getAttribute("src")).toContain("/cdn-cgi/image/width=240");
    expect(thumb.getAttribute("src")).toContain("/api/blob/images/a.webp");

    fireEvent.error(thumb);
    await waitFor(() => {
      expect(thumb.getAttribute("src")).toBe(EXISTING[0]!.url);
    });
  });
});
