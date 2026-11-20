import { Schema, model } from "mongoose";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTENT_TYPES,
  type IDocument,
} from "../types/document.types.js";

const normalizeTechnologies = (tags: string[]): string[] =>
  tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0);

const documentSchema = new Schema<IDocument>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      match: [/^https?:\/\//i, "URL must use the http(s) scheme"],
    },
    source: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
    },
    category: {
      type: String,
      required: true,
      enum: DOCUMENT_CATEGORIES,
    },
    contentType: {
      type: String,
      required: true,
      enum: DOCUMENT_CONTENT_TYPES,
    },
    technologies: {
      type: [String],
      default: [],
      set: normalizeTechnologies,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    contentHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^[a-f0-9]{64}$/, "contentHash must be a SHA-256 hex digest"],
    },
    sourceId: {
      type: String,
      trim: true,
    },
    author: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    publishedAt: {
      type: Date,
    },
    // Derived embedding state (M7.1). Canonical enough to rebuild ES from
    // Mongo alone; staleness is decided by comparing embeddedContentHash
    // and embeddingModel against the live provider.
    contentVector: {
      type: [Number],
    },
    embeddingModel: {
      type: String,
      trim: true,
    },
    embeddedContentHash: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^[a-f0-9]{64}$/, "embeddedContentHash must be a SHA-256 hex digest"],
    },
  },
  {
    timestamps: true,
    // __v is a Mongoose-internal version key; keep it out of API responses.
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Identity: a canonical URL is unique per source. The same URL may exist
// under different sources; contentHash alone is never an identity.
documentSchema.index({ source: 1, url: 1 }, { unique: true });

// External-id identity for sources that provide one. A sparse index would
// still index every document (source always exists) and collide on
// sourceId: null, so use a partial index that only covers documents where
// sourceId is actually present.
documentSchema.index(
  { source: 1, sourceId: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceId: { $exists: true } },
  }
);

documentSchema.index({ category: 1 });
documentSchema.index({ technologies: 1 });
documentSchema.index({ contentHash: 1 });

export const DocumentModel = model<IDocument>("Document", documentSchema);
