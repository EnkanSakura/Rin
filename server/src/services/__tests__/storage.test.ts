import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BlobService, StorageService } from '../storage';
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Variables, JWTUtils, CacheImpl } from "../../core/hono-types";
import { createMockDB, createMockEnv, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';

// Simple cache implementation for tests
class TestCacheImpl implements CacheImpl {
    private data = new Map<string, any>();
    
    async get(key: string): Promise<any | null> {
        return this.data.get(key) ?? null;
    }
    
    async set(key: string, value: any, _save?: boolean): Promise<void> {
        this.data.set(key, value);
    }
    
    async delete(key: string, _save?: boolean): Promise<void> {
        this.data.delete(key);
    }
    
    async deletePrefix(prefix: string): Promise<void> {
        for (const key of this.data.keys()) {
            if (key.startsWith(prefix)) {
                this.data.delete(key);
            }
        }
    }
    
    async getOrSet<T>(key: string, factory: () => Promise<T>): Promise<T> {
        const cached = await this.get(key);
        if (cached !== null) return cached;
        const value = await factory();
        await this.set(key, value);
        return value;
    }
    
    async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
        const cached = await this.get(key);
        return cached !== null ? cached : defaultValue;
    }
    
    async getBySuffix(_suffix: string): Promise<any[]> {
        return [];
    }
    
    async all(): Promise<Map<string, any>> {
        return new Map(this.data);
    }
    
    async save(): Promise<void> {}
    async clear(): Promise<void> {
        this.data.clear();
    }
}

describe('StorageService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    beforeEach(async () => {
        const mockDB = createMockDB();
        db = mockDB.db;
        sqlite = mockDB.sqlite;
        env = createMockEnv();

        app = new Hono<{ Bindings: Env; Variables: Variables }>();
        
        // Mock middleware to inject dependencies
        app.use(createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
            c.set('db', db);
            c.set('cache', new TestCacheImpl());
            c.set('serverConfig', new TestCacheImpl());
            c.set('clientConfig', new TestCacheImpl());
            c.set('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            } as JWTUtils);
            c.set('oauth2', undefined);
            c.set('admin', false);
            c.set('env', env);
            c.set('uid', undefined);
            
            await next();
        }));

        // Mount service
        app.route('/', StorageService());
        app.route('/blob', BlobService());

        // Create test user
        await createTestUser();
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function createTestUser() {
        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (1, 'testuser', 'gh_test', 'avatar.png', 1)
        `);
    }

    function createAppWithEnv(appEnv: Env, uid?: number, serverConfig?: TestCacheImpl) {
        const serviceApp = new Hono<{ Bindings: Env; Variables: Variables }>();
        serviceApp.use(createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
            c.set('db', db);
            c.set('cache', new TestCacheImpl());
            c.set('serverConfig', serverConfig ?? new TestCacheImpl());
            c.set('clientConfig', new TestCacheImpl());
            c.set('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            } as JWTUtils);
            c.set('env', appEnv);
            c.set('uid', uid);
            await next();
        }));
        serviceApp.route('/', StorageService());
        serviceApp.route('/blob', BlobService());
        return serviceApp;
    }

    describe('POST / - Upload file', () => {
        it('should require authentication', async () => {
            const formData = new FormData();
            formData.append('file', new File(['test content'], 'test.txt', { type: 'text/plain' }));
            
            const res = await app.request('/', {
                method: 'POST',
                body: formData,
            }, env);

            // Could be 400 (validation) or 401 (auth)
            expect(res.status).toBeGreaterThanOrEqual(400);
            expect(res.status).toBeLessThanOrEqual(401);
        });

        it('should upload through R2 binding when configured', async () => {
            const putCalls: Array<{ key: string; type: string | undefined }> = [];
            const r2Env = createMockEnv({
                R2_BUCKET: {
                    put: async (key: string, value: any, options?: R2PutOptions) => {
                        putCalls.push({
                            key,
                            type: options?.httpMetadata && 'contentType' in options.httpMetadata
                                ? options.httpMetadata.contentType
                                : undefined,
                        });
                        return {
                            key,
                            version: '1',
                            size: value.size || 0,
                            etag: 'etag',
                            httpEtag: 'etag',
                            uploaded: new Date(),
                            storageClass: 'Standard',
                            checksums: {} as R2Checksums,
                            writeHttpMetadata: () => {},
                        } as unknown as R2Object;
                    },
                } as unknown as R2Bucket,
                S3_ACCESS_HOST: 'https://images.example.com' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
            });

            const r2App = createAppWithEnv(r2Env, 1);
            const formData = new FormData();
            formData.append('key', 'test.txt');
            formData.append('file', new File(['test content'], 'test.txt', { type: 'text/plain' }));

            const res = await r2App.request('/', {
                method: 'POST',
                body: formData,
            }, r2Env);

            expect(res.status).toBe(200);
            expect(putCalls).toHaveLength(1);
            expect(putCalls[0]?.key).toMatch(/^images\/[a-f0-9]+\.txt$/);
            expect(putCalls[0]?.type).toBe('text/plain;charset=utf-8');
            const payload = await res.json() as { url: string };
            expect(payload.url).toMatch(/^https:\/\/images\.example\.com\/images\/[a-f0-9]+\.txt$/);
        });

        it('should return an /api/blob URL when R2 is configured without S3_ACCESS_HOST', async () => {
            const putCalls: string[] = [];
            const r2Env = createMockEnv({
                R2_BUCKET: {
                    put: async (key: string) => {
                        putCalls.push(key);
                        return {
                            key,
                            version: '1',
                            size: 4,
                            etag: 'etag',
                            httpEtag: 'etag',
                            uploaded: new Date(),
                            storageClass: 'Standard',
                            checksums: {} as R2Checksums,
                            writeHttpMetadata: () => {},
                        } as unknown as R2Object;
                    },
                } as unknown as R2Bucket,
                S3_ACCESS_HOST: '' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
            });

            const r2App = createAppWithEnv(r2Env, 1);
            const formData = new FormData();
            formData.append('key', 'test.txt');
            formData.append('file', new File(['test'], 'test.txt', { type: 'text/plain' }));

            const res = await r2App.request('/', {
                method: 'POST',
                body: formData,
            }, r2Env);

            expect(res.status).toBe(200);
            expect(putCalls).toHaveLength(1);

            const payload = await res.json() as { url: string };
            expect(payload.url).toMatch(/^http:\/\/localhost\/api\/blob\/images\/[a-f0-9]+\.txt$/);
        });

        it('should return 500 when S3_ENDPOINT is not defined without R2 binding', async () => {
            const envNoS3 = createMockEnv({
                S3_ENDPOINT: '' as any,
            });
            const appNoS3 = createAppWithEnv(envNoS3, 1);

            const formData = new FormData();
            formData.append('key', 'test.txt');
            formData.append('file', new File(['test content'], 'test.txt', { type: 'text/plain' }));
            
            const res = await appNoS3.request('/', {
                method: 'POST',
                body: formData,
            }, envNoS3);

            expect(res.status).toBe(500);
            expect(await res.text()).toBe('S3_ENDPOINT is not defined');
        });

        it('should return error when S3_ACCESS_KEY_ID is not defined without R2 binding', async () => {
            const envNoKey = createMockEnv({
                S3_ACCESS_KEY_ID: '',
            });
            const appNoKey = createAppWithEnv(envNoKey, 1);

            const formData = new FormData();
            formData.append('key', 'test.txt');
            formData.append('file', new File(['test content'], 'test.txt', { type: 'text/plain' }));
            
            const res = await appNoKey.request('/', {
                method: 'POST',
                body: formData,
            }, envNoKey);

            expect(res.status).toBe(500);
            expect(await res.text()).toBe('S3_ACCESS_KEY_ID is not defined');
        });

        it('should convert GIF through the processor and store as WebP', async () => {
            const putCalls: Array<{ key: string; type: string | undefined }> = [];
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async (input: any, init?: any) => {
                const url = String(input);
                if (url.includes('gif-processor')) {
                    expect(init?.headers?.['Authorization']).toBe('Bearer test-secret');
                    // Processor expects multipart/form-data with a "file" field
                    expect(init?.body).toBeInstanceOf(FormData);
                    expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
                    return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
                        status: 200,
                        headers: { 'Content-Type': 'image/webp' },
                    });
                }
                return originalFetch(input, init);
            }) as typeof fetch;

            const r2Env = createMockEnv({
                R2_BUCKET: {
                    put: async (key: string, value: any, options?: R2PutOptions) => {
                        putCalls.push({
                            key,
                            type: options?.httpMetadata && 'contentType' in options.httpMetadata
                                ? options.httpMetadata.contentType
                                : undefined,
                        });
                        return {
                            key,
                            version: '1',
                            size: value?.size || 4,
                            etag: 'etag',
                            httpEtag: 'etag',
                            uploaded: new Date(),
                            storageClass: 'Standard',
                            checksums: {} as R2Checksums,
                            writeHttpMetadata: () => {},
                        } as unknown as R2Object;
                    },
                } as unknown as R2Bucket,
                S3_ACCESS_HOST: 'https://images.example.com' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
            });

            const mockServerConfig = new TestCacheImpl();
            await mockServerConfig.set('image_compression.gif_processor_url', 'https://gif-processor.example.com/convert');
            await mockServerConfig.set('image_compression.gif_processor_secret', 'test-secret');
            const r2App = createAppWithEnv(r2Env, 1, mockServerConfig);
            const formData = new FormData();
            formData.append('key', 'anim.gif');
            formData.append('file', new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }));

            const res = await r2App.request('/', {
                method: 'POST',
                body: formData,
            }, r2Env);

            globalThis.fetch = originalFetch;

            expect(res.status).toBe(200);
            expect(putCalls).toHaveLength(1);
            expect(putCalls[0]?.key).toMatch(/^images\/[a-f0-9]+\.webp$/);
            expect(putCalls[0]?.type).toBe('image/webp');
            const payload = await res.json() as { success: boolean; url: string };
            expect(payload.success).toBe(true);
            expect(payload.url).toMatch(/^https:\/\/images\.example\.com\/images\/[a-f0-9]+\.webp$/);
        });

        it('should return error when GIF processor fails', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = (async () => {
                return new Response('processing error', { status: 500, statusText: 'Internal Server Error' });
            }) as typeof fetch;

            const r2Env = createMockEnv({
                R2_BUCKET: {} as unknown as R2Bucket,
                S3_ACCESS_HOST: 'https://images.example.com' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
            });

            const mockServerConfig = new TestCacheImpl();
            await mockServerConfig.set('image_compression.gif_processor_url', 'https://gif-processor.example.com/convert');
            const r2App = createAppWithEnv(r2Env, 1, mockServerConfig);
            const formData = new FormData();
            formData.append('key', 'anim.gif');
            formData.append('file', new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }));

            const res = await r2App.request('/', {
                method: 'POST',
                body: formData,
            }, r2Env);

            globalThis.fetch = originalFetch;

            expect(res.status).toBe(400);
            expect(await res.text()).toContain('GIF processing failed');
        });

        it('should reject oversized files', async () => {
            const putCalls: string[] = [];
            const r2Env = createMockEnv({
                R2_BUCKET: {
                    put: async (key: string) => {
                        putCalls.push(key);
                        return {
                            key,
                            version: '1',
                            size: 4,
                            etag: 'etag',
                            httpEtag: 'etag',
                            uploaded: new Date(),
                            storageClass: 'Standard',
                            checksums: {} as R2Checksums,
                            writeHttpMetadata: () => {},
                        } as unknown as R2Object;
                    },
                } as unknown as R2Bucket,
                S3_ACCESS_HOST: 'https://images.example.com' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
            });

            const r2App = createAppWithEnv(r2Env, 1);
            const formData = new FormData();
            formData.append('key', 'big.png');
            formData.append('file', new File([new Uint8Array(11 * 1024 * 1024)], 'big.png', { type: 'image/png' }));

            const res = await r2App.request('/', {
                method: 'POST',
                body: formData,
            }, r2Env);

            expect(res.status).toBe(413);
            expect(await res.text()).toContain('File too large');
            expect(putCalls).toHaveLength(0);
        });
    });

    describe('GET /images - List stored images', () => {
        function r2AppWithObjects(
            objects: Array<{ key: string; size: number; uploaded: Date }>,
            uid: number | null = 1,
        ) {
            const listCalls: Array<{ prefix?: string; cursor?: string; limit?: number }> = [];
            const r2Env = createMockEnv({
                R2_BUCKET: {
                    list: async (options: { prefix?: string; cursor?: string; limit?: number } = {}) => {
                        listCalls.push(options);
                        const scoped = objects.filter((object) =>
                            options.prefix ? object.key.startsWith(options.prefix) : true,
                        );
                        return {
                            objects: scoped.map((object) => ({
                                key: object.key,
                                size: object.size,
                                uploaded: object.uploaded,
                            })),
                            truncated: false,
                        };
                    },
                } as unknown as R2Bucket,
                S3_ACCESS_HOST: 'https://images.example.com' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
            });
            return { app: createAppWithEnv(r2Env, uid ?? undefined), env: r2Env, listCalls };
        }

        it('requires authentication', async () => {
            const { app: r2App, env: r2Env, listCalls } = r2AppWithObjects([], null);
            const res = await r2App.request('/images', { method: 'GET' }, r2Env);
            expect(res.status).toBe(401);
            expect(listCalls).toHaveLength(0);
        });

        it('lists images only, newest first, and skips cached objects', async () => {
            const { app: r2App, env: r2Env } = r2AppWithObjects([
                { key: 'images/old.png', size: 10, uploaded: new Date('2025-01-01T00:00:00Z') },
                { key: 'images/new.webp', size: 20, uploaded: new Date('2025-06-01T00:00:00Z') },
                { key: 'images/notes.txt', size: 5, uploaded: new Date('2025-07-01T00:00:00Z') },
                { key: 'cache/thumb.png', size: 7, uploaded: new Date('2025-08-01T00:00:00Z') },
            ]);

            const res = await r2App.request('/images', { method: 'GET' }, r2Env);
            expect(res.status).toBe(200);

            const payload = await res.json() as {
                success: boolean;
                total: number;
                cursor: string | null;
                items: Array<{ key: string; url: string; uploadedAt: string }>;
            };
            expect(payload.success).toBe(true);
            expect(payload.total).toBe(2);
            expect(payload.cursor).toBeNull();
            expect(payload.items.map((item) => item.key)).toEqual(['images/new.webp', 'images/old.png']);
            expect(payload.items[0]!.url).toBe('https://images.example.com/images/new.webp');
            expect(payload.items[0]!.uploadedAt).toBe('2025-06-01T00:00:00.000Z');
        });

        it('paginates with an offset cursor', async () => {
            const { app: r2App, env: r2Env } = r2AppWithObjects(
                Array.from({ length: 5 }, (_, index) => ({
                    key: `images/${index}.png`,
                    size: index,
                    uploaded: new Date(2025, 0, index + 1),
                })),
            );

            const first = await r2App.request('/images?limit=2', { method: 'GET' }, r2Env);
            const firstPage = await first.json() as { cursor: string | null; items: Array<{ key: string }> };
            expect(firstPage.items.map((item) => item.key)).toEqual(['images/4.png', 'images/3.png']);
            expect(firstPage.cursor).toBe('2');

            const second = await r2App.request(`/images?limit=2&cursor=${firstPage.cursor}`, { method: 'GET' }, r2Env);
            const secondPage = await second.json() as { cursor: string | null; items: Array<{ key: string }> };
            expect(secondPage.items.map((item) => item.key)).toEqual(['images/2.png', 'images/1.png']);
            expect(secondPage.cursor).toBe('4');

            const last = await r2App.request('/images?limit=2&cursor=4', { method: 'GET' }, r2Env);
            const lastPage = await last.json() as { cursor: string | null; items: Array<{ key: string }> };
            expect(lastPage.items.map((item) => item.key)).toEqual(['images/0.png']);
            expect(lastPage.cursor).toBeNull();
        });

        it('lists images through the S3 API when no R2 binding is configured', async () => {
            const originalFetch = globalThis.fetch;
            const listUrls: string[] = [];
            globalThis.fetch = (async (input: any) => {
                const url = input instanceof Request ? input.url : String(input);
                listUrls.push(url);
                return new Response(
                    `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>images/s3.png</Key><LastModified>2025-03-01T00:00:00.000Z</LastModified><Size>42</Size></Contents>
  <Contents><Key>images/s3.gif</Key><LastModified>2025-02-01T00:00:00.000Z</LastModified><Size>21</Size></Contents>
</ListBucketResult>`,
                    { status: 200, headers: { 'content-type': 'application/xml' } },
                );
            }) as typeof fetch;

            try {
                const s3Env = createMockEnv({
                    R2_BUCKET: undefined,
                    S3_FOLDER: 'images/',
                    S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com' as any,
                    S3_BUCKET: 'rin' as any,
                    S3_ACCESS_KEY_ID: 'key',
                    S3_SECRET_ACCESS_KEY: 'secret',
                    S3_ACCESS_HOST: '' as any,
                });
                const s3App = createAppWithEnv(s3Env, 1);

                const res = await s3App.request('/images', { method: 'GET' }, s3Env);
                expect(res.status).toBe(200);
                const payload = await res.json() as {
                    total: number;
                    items: Array<{ key: string; url: string; size: number }>;
                };
                expect(payload.total).toBe(2);
                expect(payload.items.map((item) => item.key)).toEqual(['images/s3.png', 'images/s3.gif']);
                expect(payload.items[0]!.size).toBe(42);
                expect(payload.items[0]!.url).toBe('http://localhost/api/blob/images/s3.png');
                expect(listUrls[0]).toContain('list-type=2');
                expect(listUrls[0]).toContain('prefix=images%2F');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('GET /blob/* - Stream file', () => {
        it('should stream an R2 object through the blob route', async () => {
            const r2Env = createMockEnv({
                R2_BUCKET: {
                    get: async (key: string) => {
                        if (key !== 'images/test.txt') {
                            return null;
                        }

                        return {
                            key,
                            size: 4,
                            etag: 'etag',
                            httpEtag: 'etag',
                            uploaded: new Date('2025-01-01T00:00:00Z'),
                            storageClass: 'Standard',
                            checksums: {} as R2Checksums,
                            httpMetadata: { contentType: 'text/plain' },
                            writeHttpMetadata(headers: Headers) {
                                headers.set('Content-Type', 'text/plain');
                            },
                            body: new Blob(['test']).stream(),
                            bodyUsed: false,
                            arrayBuffer: async () => new TextEncoder().encode('test').buffer,
                            text: async () => 'test',
                            json: async () => ({ value: 'test' }),
                            blob: async () => new Blob(['test']),
                            bytes: async () => new Uint8Array(new TextEncoder().encode('test')),
                        } as unknown as R2ObjectBody;
                    },
                } as unknown as R2Bucket,
                S3_ACCESS_HOST: '' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
            });

            const r2App = createAppWithEnv(r2Env, 1);
            const res = await r2App.request('/blob/images/test.txt', { method: 'GET' }, r2Env);

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('text/plain');
            expect(await res.text()).toBe('test');
        });
    });
});