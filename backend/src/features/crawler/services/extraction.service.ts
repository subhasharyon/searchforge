import * as cheerio from "cheerio";
import TurndownService from "turndown";
import {
  ExtractionError,
  type ExtractionResult,
} from "../types/crawler.types.js";

/**
 * HTML -> Markdown conversion. fenced code blocks preserve indentation and
 * meaningful technical formatting inside <pre>/<code>.
 */
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});

const BOILERPLATE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "svg",
  "canvas",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="search"]',
  '[aria-hidden="true"]',
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="cookie-banner"]',
  '[class*="breadcrumb"]',
  // Sidebar selectors are deliberately token/tag-aware: a bare substring
  // match like `[class*="sidebar"]` removes layout wrappers whose classes
  // merely mention sidebars ("with-sidebar", "grid-cols-sidebar-content")
  // and destroys the content inside them. Verified against
  // docs.docker.com + react.dev markup (M7.5 fix).
  'aside[class*="sidebar"], nav[class*="sidebar"], details[class*="sidebar"]',
  '[class~="sidebar"], [id="sidebar"]',
  '[class^="sidebar-"], [class*=" sidebar-"]',
  '[id^="sidebar-"], [id*=" sidebar-"]',
  '[class*="newsletter"]',
  '[class*="pagination"]',
].join(", ");

const MAIN_SELECTOR = "main, article, [role='main'], #main, .main";

const firstMeta = ($: cheerio.CheerioAPI, names: string[]): string | undefined => {
  for (const name of names) {
    const value =
      $(`meta[name="${name}"]`).attr("content") ??
      $(`meta[property="${name}"]`).attr("content");
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

/**
 * Extracts the meaningful technical content of a documentation page:
 * title, canonical link, main text (as Markdown preserving code blocks),
 * author and publish date when declared. Navigation, footers, cookie
 * banners and other boilerplate are stripped before conversion.
 */
export const extractContent = (
  html: string,
  pageUrl: string,
  allowedDomains: readonly string[]
): ExtractionResult => {
  const $ = cheerio.load(html);

  const title =
    firstMeta($, ["og:title", "twitter:title"]) ??
    $("title").first().text().trim() ??
    "";

  // Canonical link: use it only when it resolves back to an approved domain,
  // so a page can never re-point the crawl identity at an unapproved host.
  const canonicalHref = $('link[rel="canonical"]').attr("href");
  let canonicalUrl: string | undefined;
  if (canonicalHref) {
    try {
      const canonical = new URL(canonicalHref, pageUrl);
      if (
        (canonical.protocol === "https:" || canonical.protocol === "http:") &&
        allowedDomains.includes(canonical.hostname.toLowerCase())
      ) {
        canonical.hash = "";
        canonicalUrl = canonical.href;
      }
    } catch {
      // malformed canonical - ignore
    }
  }

  // First main-like container in document order; falls back to <body>.
  // Resolved BEFORE stripping: a boilerplate selector must never remove
  // an ancestor of the content we want, so those elements are skipped.
  const root = $(MAIN_SELECTOR).first();
  const contentAncestors = new Set<unknown>(root.parents().toArray());
  $(BOILERPLATE_SELECTORS).each((_, el) => {
    if (!contentAncestors.has(el)) {
      $(el).remove();
    }
  });
  const fragment = (root.length > 0 ? root : $("body")).html();
  const content = turndown.turndown(fragment ?? "");
  if (content.trim().length === 0) {
    throw new ExtractionError("No extractable content on page");
  }

  const author = firstMeta($, ["author", "article:author"]);
  const publishedRaw = firstMeta($, [
    "article:published_time",
    "date",
    "dc.date",
    "dcterms.created",
  ]);
  const publishedTime = publishedRaw ? Date.parse(publishedRaw) : NaN;

  const result: ExtractionResult = {
    title:
      title ||
      // Fall back to the last meaningful path segment as a title.
      decodeURIComponent(
        new URL(pageUrl).pathname.split("/").filter(Boolean).pop() ?? "Untitled"
      ),
    content,
  };
  if (canonicalUrl) {
    result.canonicalUrl = canonicalUrl;
  }
  if (author) {
    result.author = author.slice(0, 200);
  }
  if (Number.isFinite(publishedTime)) {
    result.publishedAt = new Date(publishedTime);
  }
  return result;
};
