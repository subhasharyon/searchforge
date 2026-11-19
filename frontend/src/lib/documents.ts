/** MongoDB ObjectId — 24 lowercase/uppercase hex characters. */
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/

export function isValidDocumentId(id: string): boolean {
  return OBJECT_ID_PATTERN.test(id)
}

/**
 * Sanitizes the `from` return path passed to the document page.
 * Only same-origin /search paths are accepted — anything else falls back
 * to plain /search, which prevents open redirects.
 */
export function sanitizeReturnPath(value: unknown): string {
  if (typeof value === "string" && /^\/search(\?|\/|$)/.test(value)) {
    return value
  }
  return "/search"
}

/**
 * Returns the URL only when it uses http(s). Backend data is untrusted —
 * this keeps `javascript:`/`data:` schemes out of anchor hrefs.
 */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
      ? value
      : null
  } catch {
    return null
  }
}
