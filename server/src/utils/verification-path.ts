// Validation for domain-verification TXT file paths (e.g. /google123.txt, /.well-known/google123.txt)
// Shared by the admin service (write path) and the fetch handler (read path) so the two
// can never disagree about which paths are legal.

export const MAX_VERIFICATION_PATH_LENGTH = 200;
export const MAX_VERIFICATION_CONTENT_LENGTH = 4096;
export const MAX_VERIFICATION_PATH_SEGMENTS = 4;

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * A legal verification file path:
 * - absolute (starts with "/")
 * - ends with ".txt"
 * - every segment is made of safe characters only ([A-Za-z0-9._-])
 * - no "..", no segment that is "." or ends with ".", no empty segments
 * - no "%", "\", control characters, no "/api" prefix, bounded depth/length
 */
export function isValidVerificationPath(path: unknown): path is string {
  if (typeof path !== "string") {
    return false;
  }

  if (path.length === 0 || path.length > MAX_VERIFICATION_PATH_LENGTH) {
    return false;
  }

  if (!path.startsWith("/") || !path.endsWith(".txt")) {
    return false;
  }

  // Reject path traversal, backslashes, percent-encoding ambiguity and control chars
  if (path.includes("..") || path.includes("\\") || path.includes("%")) {
    return false;
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    return false;
  }

  // "/api" is served by the API router - never allow it as a verification path
  if (path === "/api" || path.startsWith("/api/")) {
    return false;
  }

  const segments = path.split("/");
  // path starts with "/", so the first item is "" (the leading root)
  if (segments[0] !== "") {
    return false;
  }

  const parts = segments.slice(1);
  if (parts.length === 0 || parts.length > MAX_VERIFICATION_PATH_SEGMENTS) {
    return false;
  }

  for (const part of parts) {
    if (part === "" || part === "." || part === ".." || part.endsWith(".")) {
      return false;
    }
    if (!PATH_SEGMENT_PATTERN.test(part)) {
      return false;
    }
  }

  return true;
}

/** True when the content looks acceptable for a plain-text verification file. */
export function isValidVerificationContent(content: unknown): content is string {
  return typeof content === "string" && content.length <= MAX_VERIFICATION_CONTENT_LENGTH;
}