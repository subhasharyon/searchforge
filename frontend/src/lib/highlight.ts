const OPEN_PLACEHOLDER = "MARK_OPEN";
const CLOSE_PLACEHOLDER = "MARK_CLOSE";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Converts a backend highlight fragment into safe HTML.
 *
 * Elasticsearch wraps matches in <mark> tags but does not escape the
 * surrounding text, so the fragment is escaped wholesale first and only
 * the two known marker tags are re-enabled afterwards. Any other markup
 * in the source content stays inert.
 */
export function highlightToHtml(fragment: string): string {
  const stripped = fragment
    .replaceAll("<mark>", OPEN_PLACEHOLDER)
    .replaceAll("</mark>", CLOSE_PLACEHOLDER);
  return escapeHtml(stripped)
    .replaceAll(OPEN_PLACEHOLDER, "<mark>")
    .replaceAll(CLOSE_PLACEHOLDER, "</mark>");
}
