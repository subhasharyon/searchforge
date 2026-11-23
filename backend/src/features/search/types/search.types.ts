import type {
  DocumentCategory,
  DocumentContentType,
} from "../../documents/types/document.types.js";
import type { EmbeddingProvider } from "../services/embedding.provider.js";

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
  // Optional semantic-search projection. Present only when the
  // document carries a valid, current embedding.
  content_vector?: number[];
  embeddingModel?: string;
  embeddedContentHash?: string;
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

/** Single chunk hit - one passage plus its parent
    document identity. */
export interface PassageResultItem {
  /** Chunk ES _id: `{documentId}:{chunk_index}`. */
  id: string;
  documentId: string;
  title: string;
  url: string;
  source: string;
  category: DocumentCategory;
  contentType: DocumentContentType;
  technologies: string[];
  heading: string;
  excerpt: string;
  score: number;
  highlights: {
    content: string[];
    heading: string[];
  };
}

export interface PassageSearchResponse {
  results: PassageResultItem[];
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
  /** Documents freshly embedded during this rebuild. */
  embedded: number;
  /** Documents whose stored vector was still current and was reused. */
  vectorsReused: number;
  /** Documents indexed WITHOUT a vector because embedding failed. */
  embeddingFailed: number;
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
  deleteByQuery(opts: {
    index: string;
    query?: Record<string, unknown>;
  }): Promise<{ deleted?: number }>;
  bulk(opts: {
    index: string;
    operations: (Record<string, unknown> | SearchDocument)[];
  }): Promise<EsBulkResponse>;
  count(opts: {
    index: string;
    query?: Record<string, unknown>;
  }): Promise<{ count: number }>;
  search(opts: {
    index: string;
    size: number;
    track_total_hits?: boolean;
    from?: number;
    query?: Record<string, unknown>;
    knn?: Record<string, unknown>;
    sort?: Record<string, unknown>[];
    highlight?: Record<string, unknown>;
    _source?: string[] | boolean;
  }): Promise<EsSearchResponse>;
}

/**
 * Ranking tunables. The production defaults live in
 * search.service.ts (DEFAULT_SEARCH_RANKING); evaluation experiments
 * inject variants through SearchDeps.searchConfig.
 */
export interface SearchRankingConfig {
  titleBoost: number;
  contentBoost: number;
  technologiesBoost: number;
  /** Hybrid: RRF rank constant; default HYBRID_RANK_CONSTANT. */
  rankConstant?: number;
  /** Hybrid: fused candidate window; default HYBRID_WINDOW_SIZE. */
  hybridWindow?: number;
  /** Passage: fused candidate window; default PASSAGE_WINDOW_SIZE. */
  passageWindow?: number;
  /** Passage: max chunks per parent document; default PASSAGE_MAX_PER_DOC. */
  passageMaxPerDoc?: number;
}

export interface SearchDeps {
  client?: EsClientLike;
  /** Ranking overrides; unset means production defaults. */
  searchConfig?: SearchRankingConfig;
  /** Embedding provider override; unset resolves from configuration. */
  embeddingProvider?: EmbeddingProvider | null;
  /** Optional delay between chunk embed batches (free-tier pacing for
      bulk scripts; 0 in the live path). */
  embedBatchDelayMs?: number;
}
