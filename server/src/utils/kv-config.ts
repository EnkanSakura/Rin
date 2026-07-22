/**
 * KV-based config storage implementation.
 * Replaces D1-based CacheImpl for serverConfig and clientConfig.
 * 
 * Each config type (e.g. "client.config", "server.config") is stored as a
 * single JSON value in Workers KV, keyed by the type name itself.
 * This keeps reads/writes efficient and avoids per-key KV operations.
 */

export class KVConfigImpl {
    private kv: KVNamespace;
    private type: string;
    private data: Map<string, any> = new Map();
    private loaded: boolean = false;

    constructor(kv: KVNamespace, type: string) {
        if (!type || type.trim() === "") {
            throw new Error("Config type cannot be empty");
        }
        this.kv = kv;
        this.type = type;
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;

        try {
            const raw = await this.kv.get(this.type, "json");
            if (raw && typeof raw === "object") {
                this.data = new Map(Object.entries(raw));
            }
        } catch (e) {
            console.warn(`KVConfig[${this.type}] load failed, starting empty:`, e);
        }

        this.loaded = true;
    }

    async get(key: string): Promise<any | null> {
        await this.ensureLoaded();
        const value = this.data.get(key);
        return value !== undefined ? value : null;
    }

    async set(key: string, value: any, save: boolean = true): Promise<void> {
        await this.ensureLoaded();
        this.data.set(key, value);
        if (save) {
            await this.save();
        }
    }

    async delete(key: string, save: boolean = true): Promise<void> {
        await this.ensureLoaded();
        this.data.delete(key);
        if (save) {
            await this.save();
        }
    }

    async deletePrefix(prefix: string): Promise<void> {
        await this.ensureLoaded();
        for (const key of this.data.keys()) {
            if (key.startsWith(prefix)) {
                this.data.delete(key);
            }
        }
        await this.save();
    }

    async getOrSet<T>(key: string, factory: () => Promise<T>): Promise<T> {
        const cached = await this.get(key);
        if (cached !== null) {
            return cached as T;
        }
        const value = await factory();
        await this.set(key, value);
        return value;
    }

    async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
        return this.getOrSet(key, async () => defaultValue);
    }

    async getBySuffix(suffix: string): Promise<any[]> {
        await this.ensureLoaded();
        const result: any[] = [];
        for (const [key, value] of this.data) {
            if (key.endsWith(suffix)) {
                result.push(value);
            }
        }
        return result;
    }

    async all(): Promise<Map<string, any>> {
        await this.ensureLoaded();
        return new Map(this.data);
    }

    async save(): Promise<void> {
        const obj: Record<string, any> = {};
        for (const [key, value] of this.data) {
            if (value !== undefined) {
                obj[key] = value;
            }
        }
        await this.kv.put(this.type, JSON.stringify(obj));
    }

    async clear(): Promise<void> {
        this.data.clear();
        await this.kv.delete(this.type);
    }
}

/**
 * Factory functions to create KV config instances.
 */
export function createServerConfig(kv: KVNamespace): KVConfigImpl {
    return new KVConfigImpl(kv, "server.config");
}

export function createClientConfig(kv: KVNamespace): KVConfigImpl {
    return new KVConfigImpl(kv, "client.config");
}
