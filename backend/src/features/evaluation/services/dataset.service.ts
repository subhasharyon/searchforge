import { AppError } from "../../../shared/errors/app-error.js";
import { DocumentModel } from "../../documents/models/document.model.js";
import {
  RELEVANCE_GRADES,
  type EvaluationDataset,
  type ResolvedQuery,
} from "../types/evaluation.types.js";

/**
 * Structural validation of a dataset definition. Returns a list of
 * problems; an empty list means the dataset is well-formed. Corpus
 * existence is checked separately by resolveDatasetJudgments - a missing
 * document is a coverage gap, not a dataset defect.
 */
export const validateDataset = (dataset: EvaluationDataset): string[] => {
  const errors: string[] = [];

  if (!dataset.version.trim()) {
    errors.push("dataset version must be non-empty");
  }
  if (dataset.queries.length === 0) {
    errors.push("dataset must contain at least one query");
  }

  const seenIds = new Set<string>();
  for (const query of dataset.queries) {
    if (!query.id.trim()) {
      errors.push("query id must be non-empty");
    } else if (seenIds.has(query.id)) {
      errors.push(`duplicate query id: ${query.id}`);
    }
    seenIds.add(query.id);

    if (!query.text.trim()) {
      errors.push(`query ${query.id}: text must be non-empty`);
    }

    const seenJudgments = new Set<string>();
    for (const judgment of query.judgments) {
      if (!RELEVANCE_GRADES.includes(judgment.grade)) {
        errors.push(
          `query ${query.id}: grade ${judgment.grade} is not in 0..3`
        );
      }
      if (!judgment.source.trim() || !judgment.url.trim()) {
        errors.push(`query ${query.id}: judgment needs source and url`);
      }
      const key = `${judgment.source}\n${judgment.url}`;
      if (seenJudgments.has(key)) {
        errors.push(
          `query ${query.id}: duplicate judgment for ${judgment.url}`
        );
      }
      seenJudgments.add(key);
    }
  }
  return errors;
};

export const assertValidDataset = (dataset: EvaluationDataset): void => {
  const errors = validateDataset(dataset);
  if (errors.length > 0) {
    throw new AppError("Evaluation dataset is invalid", 500, "INVALID_DATASET", {
      errors,
    });
  }
};

/**
 * Resolves every judged (source, url) identity to a live MongoDB _id.
 * Unresolved judgments are preserved per-query for honest coverage
 * reporting - they are never silently dropped or faked.
 */
export const resolveDatasetJudgments = async (
  dataset: EvaluationDataset
): Promise<ResolvedQuery[]> => {
  const pairs = dataset.queries.flatMap((q) =>
    q.judgments.map((j) => ({ source: j.source, url: j.url }))
  );
  const uniquePairs = [
    ...new Map(pairs.map((p) => [`${p.source}\n${p.url}`, p])).values(),
  ];

  const docs = await DocumentModel.find({
    $or: uniquePairs.map((p) => ({ source: p.source, url: p.url })),
  })
    .select("_id source url")
    .lean()
    .exec();

  const idByIdentity = new Map(
    docs.map((d) => [`${d.source}\n${d.url}`, d._id.toString()])
  );

  return dataset.queries.map((query) => ({
    id: query.id,
    text: query.text,
    judgments: query.judgments
      .map((j) => {
        const documentId = idByIdentity.get(`${j.source}\n${j.url}`);
        return documentId ? { documentId, grade: j.grade } : null;
      })
      .filter((j): j is NonNullable<typeof j> => j !== null),
    unresolvedJudgments: query.judgments.filter(
      (j) => !idByIdentity.has(`${j.source}\n${j.url}`)
    ),
  }));
};
