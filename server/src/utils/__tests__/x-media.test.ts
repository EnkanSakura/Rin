import { describe, it, expect } from 'bun:test';
import {
    isAllowedTwitterMediaUrl,
    normalizeFxTwitterV1,
    normalizeFxTwitterV2,
    normalizeVxTwitter,
    parseTweetId,
} from '../x-media';

describe('parseTweetId', () => {
    it('accepts a raw numeric id', () => {
        expect(parseTweetId('1440467865409179657')).toBe('1440467865409179657');
        expect(parseTweetId('  20  ')).toBe('20');
    });

    it('accepts x.com and twitter.com status urls', () => {
        expect(parseTweetId('https://x.com/espn/status/1440467865409179657')).toBe('1440467865409179657');
        expect(parseTweetId('https://twitter.com/espn/status/1440467865409179657?s=20')).toBe('1440467865409179657');
        expect(parseTweetId('https://mobile.twitter.com/i/web/status/1961497526051185122')).toBe('1961497526051185122');
        expect(parseTweetId('https://x.com/i/status/1961497526051185122/photo/1')).toBe('1961497526051185122');
    });

    it('accepts urls without a scheme', () => {
        expect(parseTweetId('x.com/foo/status/1234567890')).toBe('1234567890');
    });

    it('rejects non-tweet input', () => {
        expect(parseTweetId('')).toBeNull();
        expect(parseTweetId('https://x.com/espn')).toBeNull();
        expect(parseTweetId('https://example.com/status/123')).toBeNull();
        expect(parseTweetId('abc')).toBeNull();
    });
});

describe('isAllowedTwitterMediaUrl', () => {
    it('allows twimg hosts', () => {
        expect(isAllowedTwitterMediaUrl('https://video.twimg.com/amplify_video/1/vid/720x720/a.mp4')).toBe(true);
        expect(isAllowedTwitterMediaUrl('https://pbs.twimg.com/media/abc.jpg?name=orig')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isAllowedTwitterMediaUrl('https://evil.com/a.mp4')).toBe(false);
        expect(isAllowedTwitterMediaUrl('https://twimg.com.evil.com/a.mp4')).toBe(false);
        expect(isAllowedTwitterMediaUrl('file:///etc/passwd')).toBe(false);
        expect(isAllowedTwitterMediaUrl('not a url')).toBe(false);
    });
});

describe('normalizeFxTwitterV2', () => {
    const payload = {
        code: 200,
        status: {
            type: 'status',
            id: '1440467865409179657',
            url: 'https://x.com/espn/status/1440467865409179657',
            text: 'IT\u2019S BACK',
            created_at: 'Wed Sep 22 00:07:56 +0000 2021',
            author: {
                screen_name: 'espn',
                name: 'ESPN',
                avatar_url: 'https://pbs.twimg.com/profile_images/a.jpg',
            },
            media: {
                all: [
                    {
                        id: '1440467347651715078',
                        url: 'https://video.twimg.com/amplify_video/1/vid/720x720/a.mp4?tag=14',
                        thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/x.jpg',
                        duration: 60.018,
                        width: 720,
                        height: 720,
                        format: 'video/mp4',
                        type: 'video',
                        formats: [
                            { url: 'https://video.twimg.com/1/pl/x.m3u8?tag=14', container: 'm3u8' },
                            { url: 'https://video.twimg.com/1/vid/320x320/b.mp4?tag=14', container: 'mp4', bitrate: 432000 },
                        ],
                    },
                ],
            },
        },
    };

    it('maps the status into a normalized tweet', () => {
        const result = normalizeFxTwitterV2(payload);
        expect(result).not.toBeNull();
        expect(result!.tweetId).toBe('1440467865409179657');
        expect(result!.authorHandle).toBe('espn');
        expect(result!.authorName).toBe('ESPN');
        expect(result!.source).toBe('fxtwitter');
        expect(result!.media).toHaveLength(1);
    });

    it('keeps only mp4 variants, highest bitrate first', () => {
        const item = normalizeFxTwitterV2(payload)!.media[0];
        expect(item.kind).toBe('video');
        expect(item.variants.map((variant) => variant.url)).toEqual([
            'https://video.twimg.com/amplify_video/1/vid/720x720/a.mp4?tag=14',
            'https://video.twimg.com/1/vid/320x320/b.mp4?tag=14',
        ]);
        expect(item.label).toBe('720x720 · 1:00');
    });

    it('marks animated gifs and requests original photos', () => {
        const result = normalizeFxTwitterV2({
            code: 200,
            status: {
                id: '1',
                author: { screen_name: 'a', name: 'A' },
                media: {
                    videos: [{ id: 'v1', type: 'gif', url: 'https://video.twimg.com/t/1.mp4', width: 480, height: 270 }],
                    photos: [{ id: 'p1', type: 'photo', url: 'https://pbs.twimg.com/media/p.jpg', width: 100, height: 50 }],
                },
            },
        })!;
        expect(result.media.map((item) => item.kind)).toEqual(['gif', 'photo']);
        expect(result.media[1].url).toBe('https://pbs.twimg.com/media/p.jpg?name=orig');
    });

    it('returns null for malformed payloads', () => {
        expect(normalizeFxTwitterV2(null)).toBeNull();
        expect(normalizeFxTwitterV2({ code: 404, status: null })).toBeNull();
        expect(normalizeFxTwitterV2({ status: { text: 'no id' } })).toBeNull();
    });
});

describe('normalizeFxTwitterV1', () => {
    it('reads media from the legacy tweet envelope', () => {
        const result = normalizeFxTwitterV1(
            {
                code: 200,
                tweet: {
                    id: '99',
                    text: 'legacy',
                    author: { screen_name: 'foo', name: 'Foo' },
                    media: {
                        videos: [{ type: 'video', url: 'https://video.twimg.com/a.mp4', width: 1280, height: 720, duration: 12 }],
                    },
                },
            },
            '99',
        )!;
        expect(result.tweetId).toBe('99');
        expect(result.media[0].url).toBe('https://video.twimg.com/a.mp4');
        expect(result.media[0].label).toBe('1280x720 · 12s');
    });
});

describe('normalizeVxTwitter', () => {
    it('maps media_extended entries', () => {
        const result = normalizeVxTwitter({
            tweetURL: 'https://twitter.com/user/status/555',
            user_name: 'User',
            user_screen_name: 'user',
            text: 'hi',
            date: 'Tue Sep 05 12:00:00 +0000 2023',
            media_extended: [
                { type: 'video', url: 'https://video.twimg.com/v.mp4', thumbnail_url: 'https://pbs.twimg.com/t.jpg', size: { width: 640, height: 360 }, duration: 30 },
                { type: 'image', url: 'https://pbs.twimg.com/i.jpg' },
            ],
        }, '555')!;
        expect(result.tweetId).toBe('555');
        expect(result.authorHandle).toBe('user');
        expect(result.media.map((item) => item.kind)).toEqual(['video', 'photo']);
        expect(result.media[0].width).toBe(640);
    });

    it('falls back to plain media urls', () => {
        const result = normalizeVxTwitter({ tweetURL: 'https://twitter.com/u/status/700000', mediaURLs: ['https://pbs.twimg.com/x.jpg'] })!;
        expect(result.media).toHaveLength(1);
        expect(result.media[0].url).toBe('https://pbs.twimg.com/x.jpg?name=orig');
    });
});
