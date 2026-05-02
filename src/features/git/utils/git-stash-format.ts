const STASH_PREFIX_PATTERN = /^(?:WIP|On|index)\s+on\s+[^:]+:\s+/i;
const ABBREVIATED_HASH_PATTERN = /^[a-f0-9]{7,40}\s+/i;

export const getStashDisplayTitle = (message?: string | null) => {
  const trimmedMessage = message?.trim() ?? "";
  const cleanedMessage = trimmedMessage
    .replace(STASH_PREFIX_PATTERN, "")
    .replace(ABBREVIATED_HASH_PATTERN, "")
    .trim();

  return cleanedMessage || "Stashed changes";
};

export const getStashPositionLabel = (stashIndex: number) =>
  stashIndex === 0 ? "Latest" : `#${stashIndex + 1}`;
