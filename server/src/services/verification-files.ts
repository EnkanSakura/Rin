import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { verificationFiles } from "../db/schema";
import { isValidVerificationContent, isValidVerificationPath } from "../utils/verification-path";

/**
 * Admin API for domain-verification TXT files.
 *
 * All routes require an authenticated administrator. The files themselves are
 * served to the public by the fetch handler (see runtime/fetch-handler.ts),
 * which resolves a matching request pathname against the `verification_files`
 * table and replies with `text/plain`.
 */
export function VerificationFileService(): Hono {
    const app = new Hono();

    function denied(c: AppContext): Response {
        return c.get('uid')
            ? c.text('Permission denied', 403)
            : c.text('Unauthorized', 401);
    }

    // GET /verification
    app.get('/', async (c: AppContext) => {
        if (!c.get('admin')) {
            return denied(c);
        }

        const db = c.get('db');
        const list = await profileAsync(c, 'verification_list_db', () =>
            db.query.verificationFiles.findMany({
                orderBy: (table: any, { asc }: { asc: any }) => [asc(table.path)],
            })
        );

        return c.json({ list });
    });

    // POST /verification
    app.post('/', async (c: AppContext) => {
        if (!c.get('admin')) {
            return denied(c);
        }

        const db = c.get('db');
        const body = await c.req.json().catch(() => null);
        const path: unknown = body?.path;
        const content: unknown = body?.content;

        if (!isValidVerificationPath(path) || !isValidVerificationContent(content)) {
            return c.text('Invalid path or content', 400);
        }

        const existing = await profileAsync(c, 'verification_create_existing', () =>
            db.query.verificationFiles.findFirst({ where: eq(verificationFiles.path, path) })
        );
        if (existing) {
            return c.text('Path already exists', 400);
        }

        const result = await profileAsync(c, 'verification_create_insert', () =>
            db.insert(verificationFiles).values({ path, content }).returning({ insertedId: verificationFiles.id })
        );

        return c.json({ id: result[0]?.insertedId ?? 0 });
    });

    // PUT /verification/:id
    app.put('/:id', async (c: AppContext) => {
        if (!c.get('admin')) {
            return denied(c);
        }

        const db = c.get('db');
        const id = parseInt(c.req.param('id'), 10);
        if (!Number.isInteger(id) || id <= 0) {
            return c.text('Invalid id', 400);
        }

        const existing = await profileAsync(c, 'verification_update_lookup', () =>
            db.query.verificationFiles.findFirst({ where: eq(verificationFiles.id, id) })
        );
        if (!existing) {
            return c.text('Not found', 404);
        }

        const body = await c.req.json().catch(() => null);
        const path: unknown = body?.path;
        const content: unknown = body?.content;

        if (!isValidVerificationPath(path) || !isValidVerificationContent(content)) {
            return c.text('Invalid path or content', 400);
        }

        if (path !== existing.path) {
            const collision = await profileAsync(c, 'verification_update_collision', () =>
                db.query.verificationFiles.findFirst({ where: eq(verificationFiles.path, path) })
            );
            if (collision) {
                return c.text('Path already exists', 400);
            }
        }

        await profileAsync(c, 'verification_update_db', () =>
            db.update(verificationFiles).set({ path, content }).where(eq(verificationFiles.id, id))
        );

        return c.text('OK');
    });

    // DELETE /verification/:id
    app.delete('/:id', async (c: AppContext) => {
        if (!c.get('admin')) {
            return denied(c);
        }

        const db = c.get('db');
        const id = parseInt(c.req.param('id'), 10);
        if (!Number.isInteger(id) || id <= 0) {
            return c.text('Invalid id', 400);
        }

        const existing = await profileAsync(c, 'verification_delete_lookup', () =>
            db.query.verificationFiles.findFirst({ where: eq(verificationFiles.id, id) })
        );
        if (!existing) {
            return c.text('Not found', 404);
        }

        await profileAsync(c, 'verification_delete_db', () =>
            db.delete(verificationFiles).where(eq(verificationFiles.id, id))
        );

        return c.text('OK');
    });

    return app;
}
