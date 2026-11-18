import type {
  DocumentCategory,
  DocumentContentType,
} from "../../documents/types/document.types.js";

/**
 * Flat JSON shape written to Elasticsearch. Deliberately mirrors the
 * canonical MongoDB document; MongoDB stays the source of truth and the
 * index can be rebuilt from it at any time.
 */
export interface SearchDocument {
  title: string;
  url: string;
  source: string;
  category: DocumentCategory;
  contentType: DocumentContentType;
  technologies: string[];
  content: string;
  contentHash: string;
  sourceId?: string;
  author?: string;
  publishedAt?: string; // ISO 8601
  createdAt: string;
  updatedAt: string;
}

/** Single search hit as exposed to API clients - never raw ES internals. */
export interface SearchResultItem {
  id: string;
  title: string;
  url: string;
  source: string;
  category: DocumentCategory;
  contentType: DocumentContentType;
  technologies: string[];
  author?: string;
  publishedAt?: string;
  updatedAt: string;
  score: number;
  highlights: {
    title: string[];
    content: string[];
  };
}

export interface SearchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
  pagination: SearchPagination;
}

export interface ReindexReport {
  fromIndex: string | null;
  toIndex: string;
  indexed: number;
  failed: number;
  batches: number;
  durationMs: number;
  /** First few bulk item failures, capped for readability. */
  errors: string[];
}

/* ------------------------------------------------------------------ */
/* Minimal Elasticsearch client surface used by this feature.          */
/* Keeping it narrow lets tests inject fakes without touching the real */
/* @elastic/elasticsearch client type graph.                            */
/* ------------------------------------------------------------------ */

export interface EsBulkResponse {
  errors: boolean;
  items: Record<string, { status?: number; error?: { reason?: string } }>[];
}

export interface EsHit {
  _id?: string;
  _score?: number | null;
  _source?: Record<string, unknown>;
  highlight?: Record<string, string[]>;
}

export interface EsSearchResponse {
  hits: {
    total: number | { value: number };
    hits: EsHit[];
  };
}

export interface EsClientLike {
  indices: {
    exists(opts: { index: string }): Promise<boolean>;
    create(opts: {
      index: string;
      settings?: Record<string, unknown>;
      mappings?: Record<string, unknown>;
    }): Promise<unknown>;
    delete(opts: { index: string }): Promise<unknown>;
    getAlias(opts: { name: string }): Promise<Record<string, unknown>>;
    existsAlias(opts: { name: string }): Promise<boolean>;
    updateAliases(opts: {
      actions: Record<string, unknown>[];
    }): Promise<unknown>;
  };
  index(opts: {
    index: string;
    id: string;
    document: SearchDocument;
  }): Promise<unknown>;
  delete(opts: { index: string; id: string }): Promise<unknown>;
  bulk(opts: {
    index: string;
    operations: (Record<string, unknown> | SearchDocument)[];
  }): Promise<EsBulkResponse>;
  search(opts: {
    index: string;
    from: number;
    size: number;
    track_total_hits: boolean;
    query: Record<string, unknown>;
    sort?: Record<string, unknown>[];
    highlight?: Record<string, unknown>;
    _source?: string[] | boolean;
  }): Promise<EsSearchResponse>;
}

export interface SearchDeps {
  client?: EsClientLike;
}
