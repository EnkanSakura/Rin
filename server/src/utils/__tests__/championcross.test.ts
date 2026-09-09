import { describe, it, expect } from 'bun:test';
import {
    browserHeaders,
    fetchCatalog,
    fetchChapterPages,
    fetchEpisodeDetail,
    imageHeaders,
    isAllowedChampionCrossUrl,
    normalizeEpisodeUrl,
    parseApiOrigin,
    parseEpisodeId,
    parsePageViewerId,
    parseScramble,
    resolveChampionCrossEpisode,
} from '../championcross';

describe('isAllowedChampionCrossUrl', () => {
    it('allows championcross and comici hosts', () => {
        expect(isAllowedChampionCrossUrl('https://championcross.jp/api/episodes')).toBe(true);
        expect(isAllowedChampionCrossUrl('https://viewer.championcross.jp/book/a.jpg?x=1')).toBe(true);
        expect(isAllowedChampionCrossUrl('https://cdn-public.comici.jp/articlevisual/1/a.webp')).toBe(true);
    });

    it('rejects other hosts and protocols', () => {
        expect(isAllowedChampionCrossUrl('https://evil.com/a.jpg')).toBe(false);
        expect(isAllowedChampionCrossUrl('https://championcross.jp.evil.com/a.jpg')).toBe(false);
        expect(isAllowedChampionCrossUrl('javascript:alert(1)')).toBe(false);
        expect(isAllowedChampionCrossUrl('nope')).toBe(false);
    });
});

describe('parseEpisodeId / normalizeEpisodeUrl', () => {
    it('extracts the episode id', () => {
        expect(parseEpisodeId('https://championcross.jp/episodes/4ba181178e095')).toBe('4ba181178e095');
        expect(parseEpisodeId('https://championcross.jp/series/8016373c7a6b3')).toBeNull();
    });

    it('normalizes urls and bare ids', () => {
        expect(normalizeEpisodeUrl('https://championcross.jp/episodes/4ba181178e095?foo=1')).toBe(
            'https://championcross.jp/episodes/4ba181178e095',
        );
        expect(normalizeEpisodeUrl('championcross.jp/episodes/4ba181178e095')).toBe(
            'https://championcross.jp/episodes/4ba181178e095',
        );
        expect(normalizeEpisodeUrl('4ba181178e095')).toBe('https://championcross.jp/episodes/4ba181178e095');
    });

    it('rejects foreign urls', () => {
        expect(normalizeEpisodeUrl('https://evil.com/episodes/4ba181178e095')).toBeNull();
        expect(normalizeEpisodeUrl('https://championcross.jp/series/abc')).toBeNull();
        expect(normalizeEpisodeUrl('')).toBeNull();
    });
});

describe('parseApiOrigin', () => {
    it('uses the data-api-domain attribute when present', () => {
        expect(parseApiOrigin('https://championcross.jp/episodes/x', '<html data-api-domain="https://api.example.com/"></html>')).toBe(
            'https://api.example.com',
        );
        expect(parseApiOrigin('https://championcross.jp/episodes/x', '<html data-api-domain="/v2/api"></html>')).toBe(
            'https://championcross.jp/v2/api',
        );
    });

    it('falls back to the default api origin', () => {
        expect(parseApiOrigin('https://championcross.jp/episodes/x', '<html></html>')).toBe('https://championcross.jp/api');
    });
});

describe('parsePageViewerId', () => {
    it('reads the viewer id from the page html', () => {
        expect(parsePageViewerId('<div comici-viewer-id="abc-123"></div>')).toBe('abc-123');
        expect(parsePageViewerId('<div></div>')).toBeNull();
    });
});

describe('parseScramble', () => {
    it('accepts arrays and stringified arrays', () => {
        expect(parseScramble('[1, 0]')).toEqual([1, 0]);
        expect(parseScramble("[8, 6, 5, 0, 7, 15, 3, 11, 12, 2, 9, 4, 10, 14, 1, 13]")).toHaveLength(16);
        expect(parseScramble([0])).toEqual([0]);
    });

    it('rejects non permutations', () => {
        expect(parseScramble('[1, 1]')).toBeNull();
        expect(parseScramble('[0, 2]')).toBeNull();
        expect(parseScramble('[0, -1]')).toBeNull();
        expect(parseScramble('nope')).toBeNull();
        expect(parseScramble(null)).toBeNull();
        expect(parseScramble({ 0: 1 })).toBeNull();
    });
});

describe('request headers', () => {
    it('always carries the episode referer', () => {
        expect(browserHeaders('https://championcross.jp/episodes/x').referer).toBe('https://championcross.jp/episodes/x');
        expect(imageHeaders('https://championcross.jp/episodes/x').origin).toBe('https://championcross.jp');
        expect(imageHeaders('https://championcross.jp/episodes/x')['sec-fetch-dest']).toBe('image');
    });
});

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('championcross api calls', () => {
    it('reads the chapter viewer id and series id', async () => {
        const fetchImpl = (async () =>
            jsonResponse({
                episode: {
                    id: 'ep1',
                    summary: { title: '第1話' },
                    series: { id: 'series1', name: 'Series' },
                    content: [{ type: 'viewer', viewerId: 'viewer-1' }],
                },
            })) as unknown as typeof fetch;

        const detail = await fetchEpisodeDetail(fetchImpl, 'https://championcross.jp/api', 'ep1', 'https://championcross.jp/episodes/ep1');
        expect(detail.viewerId).toBe('viewer-1');
        expect(detail.title).toBe('第1話');
        expect(detail.seriesId).toBe('series1');
    });

    it('paginates the catalog and marks free chapters', async () => {
        const requested: string[] = [];
        const fetchImpl = (async (input: unknown) => {
            const url = new URL(String(input));
            requested.push(url.pathname);
            if (url.pathname.endsWith('/series/access')) {
                return jsonResponse({
                    seriesAccess: { episodeAccesses: [{ episodeId: 'ep1', hasAccess: true }] },
                });
            }
            const from = Number(url.searchParams.get('episodeFrom'));
            if (from > 30) {
                return jsonResponse({ series: { episodes: [] } });
            }
            return jsonResponse({
                series: { episodes: Array.from({ length: 30 }, (_, i) => ({ id: `ep${from + i}`, title: `第${from + i}話` })) },
            });
        }) as unknown as typeof fetch;

        const chapters = await fetchCatalog(fetchImpl, 'https://championcross.jp/api', 'series1', 'https://championcross.jp/episodes/ep1');
        expect(chapters).toHaveLength(30);
        expect(chapters[0]).toMatchObject({ id: 'ep1', title: '第1話', free: true });
        expect(chapters[1].free).toBe(false);
        expect(requested.filter((path) => path.endsWith('/episodes'))).toHaveLength(2);
    });

    it('windows the contentsInfo requests and sorts pages', async () => {
        const windows: string[] = [];
        const fetchImpl = (async (input: unknown) => {
            const url = new URL(String(input));
            const from = Number(url.searchParams.get('page-from'));
            const to = Number(url.searchParams.get('page-to'));
            windows.push(`${from}-${to}`);
            const total = 130;
            const result = [] as Array<Record<string, unknown>>;
            for (let index = from; index <= Math.min(to, total - 1); index += 1) {
                result.push({
                    imageUrl: `https://viewer.championcross.jp/book/p-${index}.jpg`,
                    scramble: index % 2 === 0 ? '[1, 0]' : null,
                    sort: index,
                    width: 777,
                    height: 1200,
                });
            }
            return jsonResponse({ totalPages: total, result });
        }) as unknown as typeof fetch;

        const pages = await fetchChapterPages(fetchImpl, 'https://championcross.jp/api', 'viewer-1', 'https://championcross.jp/episodes/ep1');
        expect(pages).toHaveLength(130);
        expect(pages[0].scramble).toEqual([1, 0]);
        expect(pages[1].scramble).toBeNull();
        expect(pages[129].sort).toBe(129);
        expect(windows[0]).toBe('0-0');
        expect(windows).toContain('0-59');
        expect(windows).toContain('60-119');
        expect(windows).toContain('120-129');
    });
});

describe('resolveChampionCrossEpisode', () => {
    it('combines the page, episode and catalog apis', async () => {
        const fetchImpl = (async (input: unknown) => {
            const url = new URL(String(input));
            if (url.hostname === 'championcross.jp' && url.pathname === '/episodes/ep1') {
                return new Response('<html data-api-domain="/api"><body comici-viewer-id="page-viewer"></body></html>');
            }
            if (url.pathname === '/api/episodes/ep1') {
                return jsonResponse({
                    episode: {
                        id: 'ep1',
                        summary: { title: '第1話' },
                        series: { id: 'series1', name: 'Series' },
                        content: [{ viewerId: 'viewer-1' }],
                    },
                });
            }
            if (url.pathname === '/api/episodes') {
                return jsonResponse({
                    series: {
                        episodes: [
                            { id: 'ep1', title: '第1話' },
                            { id: 'ep2', title: '第2話' },
                        ],
                    },
                });
            }
            if (url.pathname === '/api/series/access') {
                return jsonResponse({ seriesAccess: { episodeAccesses: [{ episodeId: 'ep2', hasAccess: true }] } });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch;

        const result = await resolveChampionCrossEpisode(fetchImpl, 'https://championcross.jp/episodes/ep1');
        expect(result.apiOrigin).toBe('https://championcross.jp/api');
        expect(result.detail.viewerId).toBe('viewer-1');
        expect(result.chapters).toEqual([
            { id: 'ep1', title: '第1話', free: true, current: true },
            { id: 'ep2', title: '第2話', free: true, current: false },
        ]);
    });

    it('falls back to the page viewer id when the api omits it', async () => {
        const fetchImpl = (async (input: unknown) => {
            const url = new URL(String(input));
            if (url.pathname === '/episodes/ep9xyz') {
                return new Response('<html><body comici-viewer-id="page-viewer"></body></html>');
            }
            return jsonResponse({ episode: { id: 'ep9xyz', summary: { title: 'ep9xyz' }, series: { id: '' }, content: [] } });
        }) as unknown as typeof fetch;

        const result = await resolveChampionCrossEpisode(fetchImpl, 'ep9xyz');
        expect(result.detail.viewerId).toBe('page-viewer');
        expect(result.chapters).toHaveLength(1);
        expect(result.chapters[0].free).toBe(true);
    });

    it('rejects non championcross urls', async () => {
        await expect(resolveChampionCrossEpisode(ORIGINAL_FETCH, 'https://evil.com/episodes/ep1')).rejects.toThrow();
    });
});
