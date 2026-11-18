import type { Request, Response } from "express";
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  getDocumentBySourceUrl,
  updateDocument,
} from "../services/document.service.js";
import {
  ingestDocument,
  prepareDocumentInput,
  prepareDocumentUpdate,
} from "../services/ingestion.service.js";
import type {
  CreateDocumentRequest,
  LookupQuery,
  UpdateDocumentRequest,
} from "../validators/document.validators.js";

export const createDocumentController = async (
  req: Request,
  res: Response
) => {
  const document = await createDocument(
    prepareDocumentInput(req.body as CreateDocumentRequest)
  );

  res.status(201).json({ success: true, data: { document } });
};

export const ingestDocumentController = async (
  req: Request,
  res: Response
) => {
  const result = await ingestDocument(req.body as CreateDocumentRequest);

  res
    .status(result.outcome === "created" ? 201 : 200)
    .json({ success: true, data: result });
};

export const getDocumentController = async (req: Request, res: Response) => {
  const document = await getDocumentById(req.params.id as string);

  res.status(200).json({ success: true, data: { document } });
};

export const lookupDocumentController = async (
  req: Request,
  res: Response
) => {
  // validateQuery has already parsed and stored the query parameters.
  const { source, url } = req.query as LookupQuery;
  const document = await getDocumentBySourceUrl(source, url);

  res.status(200).json({ success: true, data: { document } });
};

export const updateDocumentController = async (
  req: Request,
  res: Response
) => {
  const document = await updateDocument(
    req.params.id as string,
    prepareDocumentUpdate(req.body as UpdateDocumentRequest)
  );

  res.status(200).json({ success: true, data: { document } });
};

export const deleteDocumentController = async (
  req: Request,
  res: Response
) => {
  await deleteDocument(req.params.id as string);

  res.status(200).json({ success: true, message: "Document deleted" });
};
