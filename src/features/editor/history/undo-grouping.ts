export type UndoEditOperation =
  | "typing.other"
  | "typing.first-space"
  | "typing.consecutive-space"
  | "typing.line-break"
  | "delete"
  | "replace"
  | "other";

interface ContentDelta {
  startOffset: number;
  insertedText: string;
  removedText: string;
  insertedLength: number;
  removedLength: number;
}

const LARGE_UNDO_DELTA_TEXT_THRESHOLD = 256 * 1024;

function isTypingOperation(operation: UndoEditOperation): boolean {
  return operation.startsWith("typing.");
}

function normalizeOperation(operation: UndoEditOperation): UndoEditOperation | "typing.space" {
  if (operation === "typing.first-space" || operation === "typing.consecutive-space") {
    return "typing.space";
  }

  if (operation === "typing.line-break") {
    return "typing.other";
  }

  return operation;
}

function getContentDelta(previousContent: string, nextContent: string): ContentDelta {
  let prefixLength = 0;
  const maxPrefixLength = Math.min(previousContent.length, nextContent.length);

  while (
    prefixLength < maxPrefixLength &&
    previousContent[prefixLength] === nextContent[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = maxPrefixLength - prefixLength;

  while (
    suffixLength < maxSuffixLength &&
    previousContent[previousContent.length - 1 - suffixLength] ===
      nextContent[nextContent.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const insertedLength = nextContent.length - suffixLength - prefixLength;
  const removedLength = previousContent.length - suffixLength - prefixLength;

  return {
    startOffset: prefixLength,
    insertedText:
      insertedLength > LARGE_UNDO_DELTA_TEXT_THRESHOLD
        ? ""
        : nextContent.slice(prefixLength, nextContent.length - suffixLength),
    removedText:
      removedLength > LARGE_UNDO_DELTA_TEXT_THRESHOLD
        ? ""
        : previousContent.slice(prefixLength, previousContent.length - suffixLength),
    insertedLength,
    removedLength,
  };
}

export interface UndoEditDelta extends ContentDelta {
  operation: UndoEditOperation;
  endOffset: number;
}

export function getUndoEditDelta(
  previousContent: string,
  nextContent: string,
  previousOperation: UndoEditOperation = "other",
): UndoEditDelta {
  const delta = getContentDelta(previousContent, nextContent);
  const operation = classifyUndoEdit(previousContent, nextContent, previousOperation);

  return {
    ...delta,
    operation,
    endOffset: delta.startOffset + delta.insertedLength,
  };
}

export function classifyUndoEdit(
  previousContent: string,
  nextContent: string,
  previousOperation: UndoEditOperation = "other",
): UndoEditOperation {
  if (previousContent === nextContent) {
    return "other";
  }

  const { insertedText, insertedLength, removedLength } = getContentDelta(
    previousContent,
    nextContent,
  );

  if (insertedLength > 0 && removedLength > 0) {
    return "replace";
  }

  if (removedLength > 0) {
    return "delete";
  }

  if (insertedText === "\n") {
    return "typing.line-break";
  }

  if (insertedText === " ") {
    return previousOperation === "typing.first-space" ||
      previousOperation === "typing.consecutive-space"
      ? "typing.consecutive-space"
      : "typing.first-space";
  }

  if (
    insertedLength === 1 &&
    insertedText &&
    !insertedText.includes("\n") &&
    !insertedText.includes("\t")
  ) {
    return "typing.other";
  }

  return "other";
}

export function shouldStartNewUndoGroup(
  previousOperation: UndoEditOperation,
  nextOperation: UndoEditOperation,
): boolean {
  const previousIsTyping = isTypingOperation(previousOperation);
  const nextIsTyping = isTypingOperation(nextOperation);

  if (nextOperation === "typing.line-break") {
    return true;
  }

  if (previousIsTyping && !nextIsTyping) {
    return true;
  }

  if (!previousIsTyping || !nextIsTyping) {
    return !(previousOperation === "delete" && nextOperation === "delete");
  }

  if (previousOperation === "typing.first-space") {
    return false;
  }

  return normalizeOperation(previousOperation) !== normalizeOperation(nextOperation);
}

export function shouldStartNewUndoGroupForDelta(
  previousOperation: UndoEditOperation,
  previousDelta: UndoEditDelta,
  nextDelta: UndoEditDelta,
): boolean {
  if (shouldStartNewUndoGroup(previousOperation, nextDelta.operation)) {
    return true;
  }

  if (nextDelta.operation.startsWith("typing.")) {
    return nextDelta.startOffset !== previousDelta.endOffset;
  }

  if (nextDelta.operation === "delete") {
    return (
      nextDelta.startOffset !== previousDelta.startOffset &&
      nextDelta.startOffset !== previousDelta.startOffset - nextDelta.removedLength
    );
  }

  return true;
}
