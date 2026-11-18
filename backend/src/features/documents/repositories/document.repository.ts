import type { HydratedDocument } from "mongoose";
import { AppError } from "../../../shared/errors/app-error.js";
import { DocumentModel } from "../models/document.model.js";
import type {
  CreateDocumentInput,
  IDocument,
  UpdateDocumentInput,
} from "../types/document.types.js";

export type DocumentDocument = HydratedDocument<IDocument>;

const MONGO_DUPLICATE_KEY_CODE = 11000;

export const documentRepository = {
  create: async (data: CreateDocumentInput): Promise<DocumentDocument> => {
    try {
      return await DocumentModel.create(data);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === MONGO_DUPLICATE_KEY_CODE
      ) {
        // (source, url) or (source, sourceId) uniqueness violated.
        throw new AppError(
          "A document with this identity already exists",
          409,
          "DOCUMENT_ALREADY_EXISTS"
        );
      }
      throw error;
    }
  },

  findById: (id: string): Promise<DocumentDocument | null> =>
    DocumentModel.findById(id).exec(),

  findByUrl: (url: string): Promise<DocumentDocument | null> =>
    DocumentModel.findOne({ url: url.trim() }).exec(),

  /** Compound-identity lookup: canonical URL scoped to a source. */
  findBySourceUrl: (
    source: string,
    url: string
  ): Promise<DocumentDocument | null> =>
    DocumentModel.findOne({
      source: source.trim().toLowerCase(),
      url: url.trim(),
    }).exec(),

  updateById: (
    id: string,
    update: UpdateDocumentInput
  ): Promise<DocumentDocument | null> =>
    DocumentModel.findByIdAndUpdate(id, update, {
      returnDocument: "after",
      runValidators: true,
    }).exec(),

  deleteById: (id: string): Promise<DocumentDocument | null> =>
    DocumentModel.findByIdAndDelete(id).exec(),
};
