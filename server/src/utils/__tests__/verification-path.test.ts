import { describe, it, expect } from 'bun:test';
import {
    isValidVerificationContent,
    isValidVerificationPath,
    MAX_VERIFICATION_CONTENT_LENGTH,
    MAX_VERIFICATION_PATH_LENGTH,
} from '../verification-path';

describe('isValidVerificationPath', () => {
    it('accepts a root-level TXT file path', () => {
        expect(isValidVerificationPath('/google123.txt')).toBe(true);
    });

    it('accepts a .well-known TXT file path', () => {
        expect(isValidVerificationPath('/.well-known/google123.txt')).toBe(true);
    });

    it('accepts nested safe directories and dashed names', () => {
        expect(isValidVerificationPath('/files/verification-google_123.txt')).toBe(true);
    });

    it('rejects paths without a leading slash', () => {
        expect(isValidVerificationPath('google123.txt')).toBe(false);
    });

    it('rejects paths not ending with .txt', () => {
        expect(isValidVerificationPath('/google123')).toBe(false);
        expect(isValidVerificationPath('/google123.TXT')).toBe(false);
        expect(isValidVerificationPath('/google123.txt/')).toBe(false);
        expect(isValidVerificationPath('/google123.txt.json')).toBe(false);
    });

    it('rejects path traversal', () => {
        expect(isValidVerificationPath('/../google123.txt')).toBe(false);
        expect(isValidVerificationPath('/google123/../../x.txt')).toBe(false);
        expect(isValidVerificationPath('/./google123.txt')).toBe(false);
        expect(isValidVerificationPath('/google123/../x.txt')).toBe(false);
        expect(isValidVerificationPath('/google123...txt')).toBe(false);
    });

    it('rejects backslashes and percent-encoding', () => {
        expect(isValidVerificationPath('/..\\google123.txt')).toBe(false);
        expect(isValidVerificationPath('/google%20123.txt')).toBe(false);
        expect(isValidVerificationPath('/google%2F123.txt')).toBe(false);
    });

    it('rejects /api prefixed paths', () => {
        expect(isValidVerificationPath('/api/google123.txt')).toBe(false);
        expect(isValidVerificationPath('/api')).toBe(false);
        expect(isValidVerificationPath('/apix.txt')).toBe(true);
    });

    it('rejects empty segments and empty paths', () => {
        expect(isValidVerificationPath('/google//123.txt')).toBe(false);
        expect(isValidVerificationPath('//google123.txt')).toBe(false);
        expect(isValidVerificationPath('/')).toBe(false);
        expect(isValidVerificationPath('')).toBe(false);
    });

    it('rejects illegal characters and control characters', () => {
        expect(isValidVerificationPath('/google 123.txt')).toBe(false);
        expect(isValidVerificationPath('/google#123.txt')).toBe(false);
        expect(isValidVerificationPath('/google?123.txt')).toBe(false);
        expect(isValidVerificationPath('/google\u0000.txt')).toBe(false);
    });

    it('rejects segment dot-suffix and dot-only segments', () => {
        expect(isValidVerificationPath('/google./123.txt')).toBe(false);
        expect(isValidVerificationPath('/google.')).toBe(false);
    });

    it('rejects overly long paths and too many segments', () => {
        expect(isValidVerificationPath(`/${'a'.repeat(MAX_VERIFICATION_PATH_LENGTH)}.txt`)).toBe(false);
        expect(isValidVerificationPath('/a/b/c/d/e.txt')).toBe(false);
    });

    it('rejects non-string input', () => {
        expect(isValidVerificationPath(undefined)).toBe(false);
        expect(isValidVerificationPath(null)).toBe(false);
        expect(isValidVerificationPath(42)).toBe(false);
        expect(isValidVerificationPath({})).toBe(false);
    });
});

describe('isValidVerificationContent', () => {
    it('accepts plain text content', () => {
        expect(isValidVerificationContent('google-site-verification=abc123')).toBe(true);
        expect(isValidVerificationContent('')).toBe(true);
    });

    it('rejects oversized content', () => {
        expect(isValidVerificationContent('a'.repeat(MAX_VERIFICATION_CONTENT_LENGTH + 1))).toBe(false);
    });

    it('rejects non-string content', () => {
        expect(isValidVerificationContent(undefined)).toBe(false);
        expect(isValidVerificationContent(null)).toBe(false);
        expect(isValidVerificationContent(123)).toBe(false);
        expect(isValidVerificationContent({ content: 'x' })).toBe(false);
    });
});
