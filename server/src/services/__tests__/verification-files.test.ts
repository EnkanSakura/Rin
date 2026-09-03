import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { VerificationFileService } from '../verification-files';
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import { setupTestApp, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';

describe('VerificationFileService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    const adminHeaders = {
        'Authorization': 'Bearer mock_token_1',
        'Content-Type': 'application/json',
    };
    const regularHeaders = {
        'Authorization': 'Bearer mock_token_2',
        'Content-Type': 'application/json',
    };
    const anonymousHeaders = { 'Content-Type': 'application/json' };

    const validBody = {
        path: '/google123.txt',
        content: 'google-site-verification=google123abc',
    };

    beforeEach(async () => {
        const ctx = await setupTestApp(VerificationFileService);
        db = ctx.db;
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;

        // Admin user (permission 1) and a regular member (permission 0)
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

    describe('GET / - List verification files', () => {
        it('should reject unauthenticated requests', async () => {
            const res = await app.request('/', { method: 'GET' }, env);
            expect(res.status).toBe(401);
        });

        it('should reject non-admin members', async () => {
            const res = await app.request('/', {
                method: 'GET',
                headers: regularHeaders,
            }, env);
            expect(res.status).toBe(403);
        });

        it('should list verification files for admin', async () => {
            sqlite.exec(`
                INSERT INTO verification_files (id, path, content) VALUES 
                (1, '/google123.txt', 'google-site-verification=abc'),
                (2, '/.well-known/google456.txt', 'google-site-verification=def')
            `);

            const res = await app.request('/', {
                method: 'GET',
                headers: adminHeaders,
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.list).toBeArray();
            expect(data.list.length).toBe(2);
            expect(data.list.map((item: any) => item.path)).toEqual([
                '/.well-known/google456.txt',
                '/google123.txt',
            ]);
            expect(data.list[1].content).toBe('google-site-verification=abc');
        });

        it('should return an empty list when nothing exists', async () => {
            const res = await app.request('/', {
                method: 'GET',
                headers: adminHeaders,
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.list).toEqual([]);
        });
    });

    describe('POST / - Create verification file', () => {
        it('should reject unauthenticated requests', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: anonymousHeaders,
                body: JSON.stringify(validBody),
            }, env);

            expect(res.status).toBe(401);
        });

        it('should reject non-admin members', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: regularHeaders,
                body: JSON.stringify(validBody),
            }, env);

            expect(res.status).toBe(403);
        });

        it('should create a root verification file as admin', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify(validBody),
            }, env);

            expect(res.status).toBe(200);
            const row = sqlite.query('SELECT path, content FROM verification_files').all() as any[];
            expect(row.length).toBe(1);
            expect(row[0].path).toBe('/google123.txt');
            expect(row[0].content).toBe('google-site-verification=google123abc');
        });

        it('should create a .well-known verification file as admin', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify({
                    path: '/.well-known/google456.txt',
                    content: 'google-site-verification=def',
                }),
            }, env);

            expect(res.status).toBe(200);
            const count = (sqlite.query('SELECT COUNT(*) AS c FROM verification_files').get() as any).c;
            expect(count).toBe(1);
        });

        it('should reject a path without the .txt extension', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify({ ...validBody, path: '/google123' }),
            }, env);

            expect(res.status).toBe(400);
            expect((sqlite.query('SELECT COUNT(*) AS c FROM verification_files').get() as any).c).toBe(0);
        });

        it('should reject path traversal attempts', async () => {
            for (const bad of [
                '/../google123.txt',
                '/google123/../../etc.txt',
                '..\\google123.txt',
                '/google123.txt/..',
            ]) {
                const res = await app.request('/', {
                    method: 'POST',
                    headers: adminHeaders,
                    body: JSON.stringify({ ...validBody, path: bad }),
                }, env);
                expect(res.status).toBe(400);
            }
            expect((sqlite.query('SELECT COUNT(*) AS c FROM verification_files').get() as any).c).toBe(0);
        });

        it('should reject /api/* paths', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify({ ...validBody, path: '/api/google123.txt' }),
            }, env);

            expect(res.status).toBe(400);
        });

        it('should reject relative paths and encoded characters', async () => {
            for (const bad of [
                'google123.txt',
                '/google%20123.txt',
                '/google123.txt%00',
            ]) {
                const res = await app.request('/', {
                    method: 'POST',
                    headers: adminHeaders,
                    body: JSON.stringify({ ...validBody, path: bad }),
                }, env);
                expect(res.status).toBe(400);
            }
            expect((sqlite.query('SELECT COUNT(*) AS c FROM verification_files').get() as any).c).toBe(0);
        });

        it('should reject empty or oversized content', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify({ ...validBody, content: 'a'.repeat(4097) }),
            }, env);

            expect(res.status).toBe(400);
        });

        it('should reject duplicate paths', async () => {
            await app.request('/', {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify(validBody),
            }, env);

            const res = await app.request('/', {
                method: 'POST',
                headers: adminHeaders,
                body: JSON.stringify({ ...validBody, content: 'google-site-verification=other' }),
            }, env);

            expect(res.status).toBe(400);
        });
    });

    describe('PUT /:id - Update verification file', () => {
        it('should update an existing file as admin', async () => {
            sqlite.exec(`
                INSERT INTO verification_files (id, path, content) VALUES 
                (1, '/google123.txt', 'google-site-verification=abc')
            `);

            const res = await app.request('/1', {
                method: 'PUT',
                headers: adminHeaders,
                body: JSON.stringify({
                    path: '/.well-known/google123.txt',
                    content: 'google-site-verification=new',
                }),
            }, env);

            expect(res.status).toBe(200);
            const row = sqlite.query('SELECT path, content FROM verification_files WHERE id = 1').get() as any;
            expect(row.path).toBe('/.well-known/google123.txt');
            expect(row.content).toBe('google-site-verification=new');
        });

        it('should reject updating to a path used by another file', async () => {
            sqlite.exec(`
                INSERT INTO verification_files (id, path, content) VALUES 
                (1, '/google123.txt', 'google-site-verification=abc'),
                (2, '/other.txt', 'google-site-verification=def')
            `);

            const res = await app.request('/1', {
                method: 'PUT',
                headers: adminHeaders,
                body: JSON.stringify({ path: '/other.txt', content: 'x' }),
            }, env);

            expect(res.status).toBe(400);
            const row = sqlite.query('SELECT path FROM verification_files WHERE id = 1').get() as any;
            expect(row.path).toBe('/google123.txt');
        });

        it('should reject illegal paths on update', async () => {
            sqlite.exec(`
                INSERT INTO verification_files (id, path, content) VALUES 
                (1, '/google123.txt', 'google-site-verification=abc')
            `);

            const res = await app.request('/1', {
                method: 'PUT',
                headers: adminHeaders,
                body: JSON.stringify({ path: '/../escape.txt', content: 'x' }),
            }, env);

            expect(res.status).toBe(400);
        });

        it('should return 404 for a missing file', async () => {
            const res = await app.request('/999', {
                method: 'PUT',
                headers: adminHeaders,
                body: JSON.stringify(validBody),
            }, env);

            expect(res.status).toBe(404);
        });

        it('should reject non-admin members', async () => {
            sqlite.exec(`
                INSERT INTO verification_files (id, path, content) VALUES 
                (1, '/google123.txt', 'google-site-verification=abc')
            `);

            const res = await app.request('/1', {
                method: 'PUT',
                headers: regularHeaders,
                body: JSON.stringify(validBody),
            }, env);

            expect(res.status).toBe(403);
        });
    });

    describe('DELETE /:id - Delete verification file', () => {
        it('should delete an existing file as admin', async () => {
            sqlite.exec(`
                INSERT INTO verification_files (id, path, content) VALUES 
                (1, '/google123.txt', 'google-site-verification=abc')
            `);

            const res = await app.request('/1', {
                method: 'DELETE',
                headers: adminHeaders,
            }, env);

            expect(res.status).toBe(200);
            const count = (sqlite.query('SELECT COUNT(*) AS c FROM verification_files').get() as any).c;
            expect(count).toBe(0);
        });

        it('should return 404 for a missing file', async () => {
            const res = await app.request('/999', {
                method: 'DELETE',
                headers: adminHeaders,
            }, env);

            expect(res.status).toBe(404);
        });

        it('should reject non-admin members', async () => {
            sqlite.exec(`
                INSERT INTO verification_files (id, path, content) VALUES 
                (1, '/google123.txt', 'google-site-verification=abc')
            `);

            const res = await app.request('/1', {
                method: 'DELETE',
                headers: regularHeaders,
            }, env);

            expect(res.status).toBe(403);
        });
    });
});
