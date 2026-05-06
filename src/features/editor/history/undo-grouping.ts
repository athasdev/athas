export type UndoEditOperation =
  | "typing.other"
  | "typing.first-space"
  | "typing.consecutive-space"
  | "typing.line-break"
  | "delete"
  | "replace"
  | "other";

interface ContentDelta {
  insertedText: string;
  removedText: string;
}

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

  return {
    insertedText: nextContent.slice(prefixLength, nextContent.length - suffixLength),
    removedText: previousContent.slice(prefixLength, previousContent.length - suffixLength),
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

  const { insertedText, removedText } = getContentDelta(previousContent, nextContent);

  if (insertedText && removedText) {
    return "replace";
  }

  if (removedText) {
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
    insertedText &&
    insertedText.length === 1 &&
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
