import "../../test/setup";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../state/config";
import { BangumiPage } from "../bangumi";

mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ORIGINAL_FETCH = globalThis.fetch;

const COMMENT = "这是一条很长的评论，用来验证悬停时会覆盖整张卡片并且不会被卡片边界截断。";

function makeItem(options: { id: number; comment: string | null; rate?: number; withImages?: boolean }) {
  return {
    subject_id: options.id,
    subject_type: 2,
    type: 2,
    rate: options.rate ?? 0,
    comment: options.comment,
    tags: [],
    ep_status: 0,
    vol_status: 0,
    updated_at: `2024-01-0${options.id}T00:00:00.000Z`,
    private: false,
    subject: {
      id: options.id,
      type: 2,
      name: `Subject ${options.id}`,
      name_cn: "",
      short_summary: "",
      date: null,
      images:
        options.withImages === false
          ? { large: "", common: "", medium: "", small: "", grid: "" }
          : {
              large: `https://lain.bgm.tv/pic/cover/l/ab/cd/${options.id}.jpg`,
              common: "",
              medium: "",
              small: "",
              grid: "",
            },
      volumes: 0,
      eps: 0,
      collection_total: 0,
      score: 0,
      rank: 0,
      tags: [],
    },
  };
}

const ITEMS = [
  makeItem({ id: 1, comment: COMMENT, rate: 8 }),
  makeItem({ id: 2, comment: null }),
];

function mockCollections(items: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/bangumi")) {
      return new Response(JSON.stringify({ data: items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function renderPage(config: Record<string, unknown>) {
  const wrapper = new ConfigWrapper(config, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={wrapper}>
      <BangumiPage />
    </ClientConfigContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("BangumiPage comment overlay", () => {
  it("shows the hint bar and a full-card overlay only for entries with a comment", async () => {
    mockCollections(ITEMS);
    const { container } = renderPage({ "bangumi.userId": "1", "bangumi.updateMode": "auto" });

    await waitFor(() => {
      expect(container.querySelectorAll("a[target='_blank']").length).toBe(2);
    });

    // Hint bar: one per commented entry, sitting at the bottom of the cover.
    const hints = Array.from(container.querySelectorAll("div")).filter(
      (node) => node.textContent === "bangumi.view_comment",
    );
    expect(hints).toHaveLength(1);

    // Overlay: covers the whole card (absolute inset-0 on a `relative` card)
    // and carries both the title and the full comment.
    const overlays = container.querySelectorAll("div.absolute.inset-0");
    expect(overlays).toHaveLength(1);
    const overlay = overlays[0] as HTMLElement;
    expect(overlay.textContent).toContain(COMMENT);
    expect(overlay.textContent).toContain("Subject 1");
    expect(overlay.className).toContain("overflow-y-auto");

    const card = overlay.closest("a") as HTMLElement;
    expect(card.className).toContain("relative");
  });
});

describe("BangumiPage grid columns", () => {
  it("uses the four column default", async () => {
    mockCollections(ITEMS);
    const { container } = renderPage({ "bangumi.userId": "1", "bangumi.updateMode": "auto" });

    await waitFor(() => {
      expect(container.querySelector(".grid")).not.toBeNull();
    });
    expect(container.querySelector(".grid")?.className).toContain("xl:grid-cols-4");
  });

  it("follows the bangumi.columns setting", async () => {
    mockCollections(ITEMS);
    const { container } = renderPage({
      "bangumi.userId": "1",
      "bangumi.updateMode": "auto",
      "bangumi.columns": 5,
    });

    await waitFor(() => {
      expect(container.querySelector(".grid")).not.toBeNull();
    });
    expect(container.querySelector(".grid")?.className).toContain("2xl:grid-cols-5");
  });
});

describe("BangumiPage cover fallback", () => {
  it("falls back to a title placeholder when an entry has no image", async () => {
    mockCollections([makeItem({ id: 3, comment: null, withImages: false })]);
    const { container } = renderPage({ "bangumi.userId": "1", "bangumi.updateMode": "auto" });

    await waitFor(() => {
      expect(container.querySelector('[role="img"]')).not.toBeNull();
    });
    const placeholder = container.querySelector('[role="img"]') as HTMLElement;
    expect(placeholder.getAttribute("aria-label")).toBe("Subject 3");
    expect(placeholder.textContent).toContain("Subject 3");
    // No <img> at all: the entry renders the generated placeholder instead.
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});
