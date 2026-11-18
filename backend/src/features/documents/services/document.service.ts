import { Types } from "mongoose";
import { AppError } from "../../../shared/errors/app-error.js";
import {
  documentRepository,
  type DocumentDocument,
} from "../repositories/document.repository.js";
import type {
  CreateDocumentInput,
  UpdateDocumentInput,
} from "../types/document.types.js";

const documentNotFound = (): AppError =>
  new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");

const assertValidDocumentId = (id: string): void => {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid document id", 400, "VALIDATION_ERROR");
  }
};

export const createDocument = (
  input: CreateDocumentInput
): Promise<DocumentDocument> => documentRepository.create(input);

export const getDocumentById = async (
  id: string
): Promise<DocumentDocument> => {
  assertValidDocumentId(id);

  const doc = await documentRepository.findById(id);
  if (!doc) {
    throw documentNotFound();
  }
  return doc;
};

export const getDocumentBySourceUrl = async (
  source: string,
  url: string
): Promise<DocumentDocument> => {
  if (!source.trim() || !url.trim()) {
    throw new AppError(
      "source and url are required",
      400,
      "VALIDATION_ERROR"
    );
  }

  const doc = await documentRepository.findBySourceUrl(source, url);
  if (!doc) {
    throw documentNotFound();
  }
  return doc;
};

export const updateDocument = async (
  id: string,
  update: UpdateDocumentInput
): Promise<DocumentDocument> => {
  assertValidDocumentId(id);

  const doc = await documentRepository.updateById(id, update);
  if (!doc) {
    throw documentNotFound();
  }
  return doc;
};

export const deleteDocument = async (
  id: string
): Promise<DocumentDocument> => {
  assertValidDocumentId(id);

  const doc = await documentRepository.deleteById(id);
  if (!doc) {
    throw documentNotFound();
  }
  return doc;
};
