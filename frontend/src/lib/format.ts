/** "Nov 18, 2026" — returns null for unparseable input. */
export function formatDate(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

/** Hostname without the `www.` prefix, falling back to the raw value. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
