import { afterEach, describe, expect, it } from 'bun:test';
import { createOutboundFetch } from '../outbound';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
});

function captureFetch() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    return calls;
}

describe('createOutboundFetch', () => {
    it('uses plain fetch when no relay is configured', async () => {
        const calls = captureFetch();
        const outbound = createOutboundFetch({} as Env);
        await outbound('https://example.com/a');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://example.com/a');
    });

    it('routes absolute urls through the relay', async () => {
        const calls = captureFetch();
        const outbound = createOutboundFetch({ DEV_FETCH_RELAY: 'http://127.0.0.1:11500/' } as Env);

        const response = await outbound('https://api.fxtwitter.com/2/status/1', {
            headers: { accept: 'application/json' },
        });

        expect(response.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://127.0.0.1:11500/__dev_fetch');
        const headers = new Headers(calls[0].init?.headers);
        expect(headers.get('x-rin-target')).toBe('https://api.fxtwitter.com/2/status/1');
        expect(headers.get('accept')).toBe('application/json');
    });

    it('keeps relative urls on the plain fetch path', async () => {
        const calls = captureFetch();
        const outbound = createOutboundFetch({ DEV_FETCH_RELAY: 'http://127.0.0.1:11500' } as Env);
        await outbound('/api/local');
        expect(calls[0].url).toBe('/api/local');
    });

    it('forwards the method and body of non-GET requests', async () => {
        const calls = captureFetch();
        const outbound = createOutboundFetch({ DEV_FETCH_RELAY: 'http://127.0.0.1:11500' } as Env);
        await outbound('https://example.com/post', { method: 'POST', body: 'payload' });
        expect(calls[0].init?.method).toBe('POST');
        expect(calls[0].init?.body).toBe('payload');
    });
});
