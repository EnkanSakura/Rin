import { asc, eq, max } from "drizzle-orm";
import { Hono } from "hono";
import { showcaseItems, showcases } from "../db/schema";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";

const CACHE_KEY = "showcase_data";
const CACHE_PREFIX = "showcase_";

function parseImageList(raw: string | null): string[] {
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
    } catch {
        return [];
    }
}

function parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(0, 50);
}

function parseNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => (typeof entry === "number" ? entry : parseInt(String(entry), 10)))
        .filter((entry) => Number.isInteger(entry) && entry > 0)
        .slice(0, 500);
}

export function ShowcaseService(): Hono {
    const app = new Hono();

    // GET /showcase - Public data: all groups with their ordered items (cached)
    app.get("/", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");

        const cached = await profileAsync(c, "showcase_list_cache_get", () => cache.get(CACHE_KEY));
        if (cached) {
            return c.json(cached);
        }

        const groupRows = await profileAsync(c, "showcase_list_groups", () =>
            db.select().from(showcases).orderBy(asc(showcases.sort_order), asc(showcases.id)),
        );

        if (groupRows.length === 0) {
            return c.json({ showcases: [] });
        }

        const itemRows = await profileAsync(c, "showcase_list_items", () =>
            db.select().from(showcaseItems).orderBy(asc(showcaseItems.sort_order), asc(showcaseItems.id)),
        );

        const itemsByGroup = new Map<number, typeof itemRows>();
        for (const row of itemRows) {
            const list = itemsByGroup.get(row.showcaseId);
            if (list) {
                list.push(row);
            } else {
                itemsByGroup.set(row.showcaseId, [row]);
            }
        }

        const data = {
            showcases: groupRows.map((group) => ({
                ...group,
                items: (itemsByGroup.get(group.id) ?? []).map((row) => ({
                    ...row,
                    images: parseImageList(row.images),
                })),
            })),
        };

        await profileAsync(c, "showcase_list_cache_set", () => cache.set(CACHE_KEY, data));
        return c.json(data);
    });

    // POST /showcase/group - Create a showcase group
    app.post("/group", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const body = await profileAsync(c, "showcase_group_create_parse", () => c.req.json());
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name) {
            return c.text("Name is required", 400);
        }
        if (name.length > 100) {
            return c.text("Name is too long", 400);
        }

        const rows = await profileAsync(c, "showcase_group_create_max", () =>
            db.select({ m: max(showcases.sort_order) }).from(showcases),
        );
        const nextOrder = (rows[0]?.m ?? 0) + 1;
        const date = new Date();
        const result = await profileAsync(c, "showcase_group_create_insert", () =>
            db.insert(showcases).values({
                name,
                sort_order: nextOrder,
                createdAt: date,
                updatedAt: date,
            }).returning({ insertedId: showcases.id }),
        );

        await profileAsync(c, "showcase_group_create_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));

        if (result.length === 0) {
            return c.text("Failed to insert", 500);
        }
        return c.json(result[0]);
    });

    // POST /showcase/group/reorder - Reorder showcase groups by id list
    app.post("/group/reorder", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const body = await profileAsync(c, "showcase_group_reorder_parse", () => c.req.json());
        const ids = parseNumberArray(body?.ids);
        if (ids.length === 0) {
            return c.text("Ids are required", 400);
        }

        for (let index = 0; index < ids.length; index++) {
            await profileAsync(c, "showcase_group_reorder_update", () =>
                db.update(showcases).set({ sort_order: index, updatedAt: new Date() })
                    .where(eq(showcases.id, ids[index])),
            );
        }

        await profileAsync(c, "showcase_group_reorder_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));
        return c.text("Updated");
    });

    // POST /showcase/group/:id - Rename a showcase group
    app.post("/group/:id", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const id_num = parseInt(c.req.param("id"), 10);
        if (!Number.isInteger(id_num)) {
            return c.text("Invalid id", 400);
        }

        const body = await profileAsync(c, "showcase_group_rename_parse", () => c.req.json());
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name) {
            return c.text("Name is required", 400);
        }
        if (name.length > 100) {
            return c.text("Name is too long", 400);
        }

        const group = await profileAsync(c, "showcase_group_rename_lookup", () =>
            db.query.showcases.findFirst({ where: eq(showcases.id, id_num) }),
        );
        if (!group) {
            return c.text("Not found", 404);
        }

        await profileAsync(c, "showcase_group_rename_db", () =>
            db.update(showcases).set({ name, updatedAt: new Date() }).where(eq(showcases.id, id_num)),
        );
        await profileAsync(c, "showcase_group_rename_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));
        return c.text("Updated");
    });

    // DELETE /showcase/group/:id - Delete a showcase group (items cascade)
    app.delete("/group/:id", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const id_num = parseInt(c.req.param("id"), 10);
        if (!Number.isInteger(id_num)) {
            return c.text("Invalid id", 400);
        }

        const group = await profileAsync(c, "showcase_group_delete_lookup", () =>
            db.query.showcases.findFirst({ where: eq(showcases.id, id_num) }),
        );
        if (!group) {
            return c.text("Not found", 404);
        }

        await profileAsync(c, "showcase_group_delete_items", () =>
            db.delete(showcaseItems).where(eq(showcaseItems.showcaseId, id_num)),
        );
        await profileAsync(c, "showcase_group_delete_db", () =>
            db.delete(showcases).where(eq(showcases.id, id_num)),
        );
        await profileAsync(c, "showcase_group_delete_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));
        return c.text("Deleted");
    });

    // POST /showcase/group/:id/item - Create an item inside a showcase group
    app.post("/group/:id/item", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const id_num = parseInt(c.req.param("id"), 10);
        if (!Number.isInteger(id_num)) {
            return c.text("Invalid id", 400);
        }

        const body = await profileAsync(c, "showcase_item_create_parse", () => c.req.json());
        const title = typeof body?.title === "string" ? body.title.trim() : "";
        const desc = typeof body?.desc === "string" ? body.desc.trim() : "";
        const images = parseStringArray(body?.images);

        if (title.length > 200) {
            return c.text("Title is too long", 400);
        }
        if (desc.length > 10000) {
            return c.text("Description is too long", 400);
        }

        const group = await profileAsync(c, "showcase_item_create_lookup", () =>
            db.query.showcases.findFirst({ where: eq(showcases.id, id_num) }),
        );
        if (!group) {
            return c.text("Not found", 404);
        }

        const rows = await profileAsync(c, "showcase_item_create_max", () =>
            db.select({ m: max(showcaseItems.sort_order) }).from(showcaseItems)
                .where(eq(showcaseItems.showcaseId, id_num)),
        );
        const nextOrder = (rows[0]?.m ?? 0) + 1;
        const date = new Date();
        const result = await profileAsync(c, "showcase_item_create_insert", () =>
            db.insert(showcaseItems).values({
                showcaseId: id_num,
                title,
                images: JSON.stringify(images),
                desc,
                sort_order: nextOrder,
                createdAt: date,
                updatedAt: date,
            }).returning({ insertedId: showcaseItems.id }),
        );

        await profileAsync(c, "showcase_item_create_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));

        if (result.length === 0) {
            return c.text("Failed to insert", 500);
        }
        return c.json(result[0]);
    });

    // POST /showcase/item/reorder - Reorder items of one group by id list
    app.post("/item/reorder", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const body = await profileAsync(c, "showcase_item_reorder_parse", () => c.req.json());
        const ids = parseNumberArray(body?.ids);
        if (ids.length === 0) {
            return c.text("Ids are required", 400);
        }

        for (let index = 0; index < ids.length; index++) {
            await profileAsync(c, "showcase_item_reorder_update", () =>
                db.update(showcaseItems).set({ sort_order: index, updatedAt: new Date() })
                    .where(eq(showcaseItems.id, ids[index])),
            );
        }

        await profileAsync(c, "showcase_item_reorder_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));
        return c.text("Updated");
    });

    // POST /showcase/item/:id - Update an item (title / images / desc / move to another group)
    app.post("/item/:id", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const id_num = parseInt(c.req.param("id"), 10);
        if (!Number.isInteger(id_num)) {
            return c.text("Invalid id", 400);
        }

        const item = await profileAsync(c, "showcase_item_update_lookup", () =>
            db.query.showcaseItems.findFirst({ where: eq(showcaseItems.id, id_num) }),
        );
        if (!item) {
            return c.text("Not found", 404);
        }

        const body = await profileAsync(c, "showcase_item_update_parse", () => c.req.json());
        const patch: {
            title?: string;
            images?: string;
            desc?: string;
            showcaseId?: number;
            updatedAt: Date;
        } = { updatedAt: new Date() };

        if (body?.title !== undefined) {
            const title = typeof body.title === "string" ? body.title.trim() : "";
            if (title.length > 200) {
                return c.text("Title is too long", 400);
            }
            patch.title = title;
        }
        if (body?.desc !== undefined) {
            const desc = typeof body.desc === "string" ? body.desc.trim() : "";
            if (desc.length > 10000) {
                return c.text("Description is too long", 400);
            }
            patch.desc = desc;
        }
        if (body?.images !== undefined) {
            patch.images = JSON.stringify(parseStringArray(body.images));
        }
        if (body?.showcaseId !== undefined) {
            const showcaseId = parseInt(String(body.showcaseId), 10);
            if (!Number.isInteger(showcaseId) || showcaseId <= 0) {
                return c.text("Invalid showcaseId", 400);
            }
            const target = await profileAsync(c, "showcase_item_update_target_lookup", () =>
                db.query.showcases.findFirst({ where: eq(showcases.id, showcaseId) }),
            );
            if (!target) {
                return c.text("Showcase not found", 404);
            }
            patch.showcaseId = showcaseId;
        }

        if (patch.title === undefined && patch.images === undefined && patch.desc === undefined
            && patch.showcaseId === undefined) {
            return c.text("Nothing to update", 400);
        }

        await profileAsync(c, "showcase_item_update_db", () =>
            db.update(showcaseItems).set(patch).where(eq(showcaseItems.id, id_num)),
        );
        await profileAsync(c, "showcase_item_update_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));
        return c.text("Updated");
    });

    // DELETE /showcase/item/:id - Delete an item
    app.delete("/item/:id", async (c: AppContext) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const uid = c.get("uid");
        const admin = c.get("admin");

        if (!uid) {
            return c.text("Unauthorized", 401);
        }
        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const id_num = parseInt(c.req.param("id"), 10);
        if (!Number.isInteger(id_num)) {
            return c.text("Invalid id", 400);
        }

        const item = await profileAsync(c, "showcase_item_delete_lookup", () =>
            db.query.showcaseItems.findFirst({ where: eq(showcaseItems.id, id_num) }),
        );
        if (!item) {
            return c.text("Not found", 404);
        }

        await profileAsync(c, "showcase_item_delete_db", () =>
            db.delete(showcaseItems).where(eq(showcaseItems.id, id_num)),
        );
        await profileAsync(c, "showcase_item_delete_cache_invalidate", () => cache.deletePrefix(CACHE_PREFIX));
        return c.text("Deleted");
    });

    return app;
}
