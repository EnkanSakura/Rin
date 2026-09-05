import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ShowcaseService } from '../showcase';
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import { setupTestApp, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';
import type { TestCacheImpl } from '../../../tests/fixtures';

describe('ShowcaseService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;
    let cache: TestCacheImpl;

    beforeEach(async () => {
        const ctx = await setupTestApp(ShowcaseService);
        db = ctx.db;
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        cache = ctx.cache;

        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (1, 'admin', 'gh_admin', 'admin.png', 1)
        `);
        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (2, 'regular', 'gh_regular', 'regular.png', 0)
        `);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function seedShowcase(name = 'Gundam', sortOrder = 0) {
        sqlite.exec(`
            INSERT INTO showcases (id, name, sort_order, created_at, updated_at) VALUES
            (1, '${name}', ${sortOrder}, unixepoch(), unixepoch())
        `);
    }

    async function seedItem(showcaseId = 1, title = 'RX-78', sortOrder = 0, images = '["https://example.com/a.jpg"]') {
        sqlite.exec(`
            INSERT INTO showcase_items (id, showcase_id, title, images, desc, sort_order, created_at, updated_at) VALUES
            (1, ${showcaseId}, '${title}', '${images}', 'desc of ${title}', ${sortOrder}, unixepoch(), unixepoch())
        `);
    }

    describe('GET / - List showcase data', () => {
        it('should return empty list when no showcase groups exist', async () => {
            const res = await app.request('/', { method: 'GET' }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.showcases).toEqual([]);
        });

        it('should return groups with nested ordered items and parsed image lists', async () => {
            seedShowcase('First', 0);
            sqlite.exec(`
                INSERT INTO showcases (id, name, sort_order, created_at, updated_at) VALUES
                (2, 'Second', 1, unixepoch(), unixepoch())
            `);
            seedItem(1, 'Item A', 0);
            sqlite.exec(`
                INSERT INTO showcase_items (id, showcase_id, title, images, desc, sort_order, created_at, updated_at) VALUES
                (2, 1, 'Item B', '["https://example.com/b.jpg","https://example.com/c.jpg"]', 'desc B', 1, unixepoch(), unixepoch()),
                (3, 2, 'Item C', '["https://example.com/d.jpg"]', 'desc C', 0, unixepoch(), unixepoch())
            `);

            const res = await app.request('/', { method: 'GET' }, env);
            expect(res.status).toBe(200);
            const data = await res.json() as any;

            expect(data.showcases.length).toBe(2);
            expect(data.showcases[0].name).toBe('First');
            expect(data.showcases[1].name).toBe('Second');
            expect(data.showcases[0].items.map((i: any) => i.title)).toEqual(['Item A', 'Item B']);
            expect(data.showcases[0].items[1].images).toEqual([
                'https://example.com/b.jpg',
                'https://example.com/c.jpg',
            ]);
            expect(data.showcases[1].items[0].showcaseId).toBe(2);
        });

        it('should return ordered items even when images column is malformed', async () => {
            seedShowcase();
            seedItem(1, 'Bad images', 0, '{not-json');

            const res = await app.request('/', { method: 'GET' }, env);
            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.showcases[0].items[0].images).toEqual([]);
        });

        it('should bypass stale public cache when cache is disabled', async () => {
            await cache.set('showcase_data', {
                showcases: [{ id: 1, name: 'Stale', items: [] }],
            });
            // cache impl is disabled via client config cache.enabled=false
            const clientConfig = (cache as any).clientConfig as TestCacheImpl;
            await clientConfig.set('cache.enabled', false);

            seedShowcase('Fresh');

            const res = await app.request('/', { method: 'GET' }, env);
            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.showcases[0].name).toBe('Fresh');
        });
    });

    describe('POST /group - Create showcase group', () => {
        it('should require authentication', async () => {
            const res = await app.request('/group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'New group' }),
            }, env);

            expect(res.status).toBe(401);
        });

        it('should reject non-admin users', async () => {
            const res = await app.request('/group', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_2',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'New group' }),
            }, env);

            expect(res.status).toBe(403);
        });

        it('should allow admin to create a group', async () => {
            const res = await app.request('/group', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'New group' }),
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.insertedId).toBeNumber();
        });

        it('should require a non-empty name', async () => {
            const res = await app.request('/group', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: '   ' }),
            }, env);

            expect(res.status).toBe(400);
        });
    });

    describe('POST /group/:id - Rename group', () => {
        beforeEach(() => {
            seedShowcase();
        });

        it('should require authentication', async () => {
            const res = await app.request('/group/1', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Renamed' }),
            }, env);

            expect(res.status).toBe(401);
        });

        it('should rename a group', async () => {
            const res = await app.request('/group/1', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'Renamed' }),
            }, env);

            expect(res.status).toBe(200);
            const row = sqlite.prepare('SELECT * FROM showcases WHERE id = 1').get() as any;
            expect(row.name).toBe('Renamed');
        });

        it('should return 404 for non-existent group', async () => {
            const res = await app.request('/group/999', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'Renamed' }),
            }, env);

            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /group/:id - Delete group', () => {
        beforeEach(() => {
            seedShowcase();
            seedItem();
        });

        it('should delete the group and cascade its items', async () => {
            const res = await app.request('/group/1', {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);

            expect(res.status).toBe(200);
            expect(sqlite.prepare('SELECT * FROM showcases WHERE id = 1').get()).toBeNull();
            expect(sqlite.prepare('SELECT * FROM showcase_items WHERE id = 1').get()).toBeNull();
        });

        it('should return 404 for non-existent group', async () => {
            const res = await app.request('/group/999', {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);

            expect(res.status).toBe(404);
        });
    });

    describe('POST /group/:id/item - Create item', () => {
        beforeEach(() => {
            seedShowcase();
        });

        it('should require authentication', async () => {
            const res = await app.request('/group/1/item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'Hi', images: ['https://example.com/x.jpg'] }),
            }, env);

            expect(res.status).toBe(401);
        });

        it('should allow admin to create an item', async () => {
            const res = await app.request('/group/1/item', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ title: 'Hi', images: ['https://example.com/x.jpg', '  '], desc: 'Hello' }),
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.insertedId).toBeNumber();

            const row = sqlite.prepare('SELECT * FROM showcase_items WHERE id = ?').get(data.insertedId) as any;
            expect(JSON.parse(row.images)).toEqual(['https://example.com/x.jpg']);
        });

        it('should return 404 for non-existent group', async () => {
            const res = await app.request('/group/999/item', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ title: 'Hi', images: [] }),
            }, env);

            expect(res.status).toBe(404);
        });
    });

    describe('POST /item/:id - Update item', () => {
        beforeEach(() => {
            seedShowcase();
            seedItem();
        });

        it('should update fields and move item between groups', async () => {
            sqlite.exec(`
                INSERT INTO showcases (id, name, sort_order, created_at, updated_at) VALUES
                (2, 'Second', 1, unixepoch(), unixepoch())
            `);

            const res = await app.request('/item/1', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'New title',
                    images: ['https://example.com/y.jpg'],
                    desc: 'New desc',
                    showcaseId: 2,
                }),
            }, env);

            expect(res.status).toBe(200);
            const row = sqlite.prepare('SELECT * FROM showcase_items WHERE id = 1').get() as any;
            expect(row.title).toBe('New title');
            expect(row.desc).toBe('New desc');
            expect(row.showcase_id).toBe(2);
            expect(JSON.parse(row.images)).toEqual(['https://example.com/y.jpg']);
        });

        it('should return 404 for non-existent item', async () => {
            const res = await app.request('/item/999', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ title: 'X' }),
            }, env);

            expect(res.status).toBe(404);
        });

        it('should reject unknown target group when moving', async () => {
            const res = await app.request('/item/1', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ showcaseId: 999 }),
            }, env);

            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /item/:id - Delete item', () => {
        beforeEach(() => {
            seedShowcase();
            seedItem();
        });

        it('should delete an item', async () => {
            const res = await app.request('/item/1', {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);

            expect(res.status).toBe(200);
            expect(sqlite.prepare('SELECT * FROM showcase_items WHERE id = 1').get()).toBeNull();
        });

        it('should require authentication', async () => {
            const res = await app.request('/item/1', { method: 'DELETE' }, env);
            expect(res.status).toBe(401);
        });
    });

    describe('Reorder endpoints', () => {
        beforeEach(() => {
            seedShowcase('A', 0);
            sqlite.exec(`
                INSERT INTO showcases (id, name, sort_order, created_at, updated_at) VALUES
                (2, 'B', 1, unixepoch(), unixepoch())
            `);
            seedItem(1, 'Item A', 0);
            sqlite.exec(`
                INSERT INTO showcase_items (id, showcase_id, title, sort_order, created_at, updated_at) VALUES
                (2, 1, 'Item B', 1, unixepoch(), unixepoch())
            `);
        });

        it('should reorder groups by the given id list', async () => {
            const res = await app.request('/group/reorder', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: [2, 1] }),
            }, env);

            expect(res.status).toBe(200);
            const rows = sqlite.prepare('SELECT id, sort_order FROM showcases ORDER BY sort_order').all() as any[];
            expect(rows.map((r) => r.id)).toEqual([2, 1]);
        });

        it('should reorder items by the given id list', async () => {
            const res = await app.request('/item/reorder', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: [2, 1] }),
            }, env);

            expect(res.status).toBe(200);
            const rows = sqlite.prepare('SELECT id, sort_order FROM showcase_items ORDER BY sort_order').all() as any[];
            expect(rows.map((r) => r.id)).toEqual([2, 1]);
        });

        it('should require ids', async () => {
            const res = await app.request('/item/reorder', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: [] }),
            }, env);

            expect(res.status).toBe(400);
        });
    });
});
