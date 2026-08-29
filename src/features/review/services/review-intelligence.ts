import { requestInlineEdit } from "@/features/editor/services/editor-inline-edit-service";
import type { ReviewHunk } from "../lib/review-hunks";
import type {
  ReviewHunkInsight,
  ReviewHunkInsightKind,
  ReviewHunkSummary,
} from "../types/review.types";

const REVIEW_SUMMARY_MODEL = "openai/gpt-5-nano";
const REVIEW_SUMMARY_BATCH_SIZE = 6;
const REVIEW_SUMMARY_INPUT_LIMIT = 10_000;

interface SummaryInput {
  id: string;
  path: string;
  patch: string;
}

function serializeBatch(batch: SummaryInput[]): string {
  return JSON.stringify({ hunks: batch });
}

export function createReviewSummaryBatches(hunks: ReviewHunk[]): SummaryInput[][] {
  const batches: SummaryInput[][] = [];
  let current: SummaryInput[] = [];

  for (const hunk of hunks) {
    const input = {
      id: hunk.id,
      path: hunk.filePath,
      patch: hunk.patch.slice(0, 6_000),
    };
    const candidate = [...current, input];
    if (
      current.length > 0 &&
      (candidate.length > REVIEW_SUMMARY_BATCH_SIZE ||
        serializeBatch(candidate).length > REVIEW_SUMMARY_INPUT_LIMIT)
    ) {
      batches.push(current);
      current = [input];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function normalizeText(value: string, wordLimit: number, characterLimit: number): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, wordLimit)
    .join(" ")
    .slice(0, characterLimit);
}

export function parseReviewSummaries(
  value: string,
  requestedIds: ReadonlySet<string>,
): Record<string, ReviewHunkSummary> {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let payload: unknown;
  try {
    payload = JSON.parse(fenceMatch?.[1] ?? trimmed) as unknown;
  } catch {
    return {};
  }
  if (!payload || typeof payload !== "object" || !("summaries" in payload)) return {};

  const summaries = (payload as { summaries?: unknown }).summaries;
  if (!Array.isArray(summaries)) return {};

  return Object.fromEntries(
    summaries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { id, title, description } = entry as {
        id?: unknown;
        title?: unknown;
        description?: unknown;
      };
      if (
        typeof id !== "string" ||
        typeof title !== "string" ||
        typeof description !== "string" ||
        !requestedIds.has(id)
      ) {
        return [];
      }
      const normalizedTitle = normalizeText(title, 7, 80);
      const normalizedDescription = normalizeText(description, 32, 260);
      return normalizedTitle && normalizedDescription
        ? [
            [
              id,
              {
                title: normalizedTitle,
                description: normalizedDescription,
              },
            ] as const,
          ]
        : [];
    }),
  );
}

export async function requestReviewHunkSummaries(
  hunks: ReviewHunk[],
): Promise<Record<string, ReviewHunkSummary>> {
  const summaries: Record<string, ReviewHunkSummary> = {};

  for (const batch of createReviewSummaryBatches(hunks)) {
    const { editedText } = await requestInlineEdit(
      {
        feature: "review-summary",
        model: REVIEW_SUMMARY_MODEL,
        beforeSelection: "",
        selectedText: serializeBatch(batch),
        instruction: "Summarize these code review hunks.",
      },
      { useHosted: true },
    );
    Object.assign(summaries, parseReviewSummaries(editedText, new Set(batch.map(({ id }) => id))));
  }

  return summaries;
}

export function parseReviewInsight(
  value: string,
  kind: ReviewHunkInsightKind,
): ReviewHunkInsight | null {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let payload: unknown;
  try {
    payload = JSON.parse(fenceMatch?.[1] ?? trimmed) as unknown;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const { title, items } = payload as { title?: unknown; items?: unknown };
  if (typeof title !== "string" || !Array.isArray(items)) return null;
  const normalizedItems = items
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeText(item, kind === "comment" ? 80 : 40, 420))
    .filter(Boolean)
    .slice(0, kind === "comment" ? 1 : 3);
  const normalizedTitle = normalizeText(title, 7, 80);
  if (!normalizedTitle || normalizedItems.length === 0) return null;

  return { kind, title: normalizedTitle, items: normalizedItems };
}

export async function requestReviewHunkInsight({
  hunk,
  kind,
  summary,
}: {
  hunk: ReviewHunk;
  kind: ReviewHunkInsightKind;
  summary: ReviewHunkSummary;
}): Promise<ReviewHunkInsight> {
  const { editedText } = await requestInlineEdit(
    {
      feature: "review-insight",
      model: REVIEW_SUMMARY_MODEL,
      beforeSelection: "",
      selectedText: JSON.stringify({
        kind,
        path: hunk.filePath,
        patch: hunk.patch.slice(0, 8_000),
        summary,
      }),
      instruction: `Generate a ${kind} review insight for this hunk.`,
    },
    { useHosted: true },
  );
  const insight = parseReviewInsight(editedText, kind);
  if (!insight) throw new Error("Athas Intelligence returned an invalid review insight.");
  return insight;
}
