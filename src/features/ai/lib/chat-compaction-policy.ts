export type ChatCompactionPolicy = "off" | "threshold" | "overflow" | "threshold_and_overflow";

export type AutoCompactionTrigger = "threshold" | "overflow";

const CHAT_COMPACTION_POLICY_LABELS: Record<ChatCompactionPolicy, string> = {
  off: "Manual only",
  threshold: "Before send",
  overflow: "On overflow",
  threshold_and_overflow: "Before send + overflow",
};

const CHAT_COMPACTION_POLICY_SHORT_LABELS: Record<ChatCompactionPolicy, string> = {
  off: "Manual",
  threshold: "Threshold",
  overflow: "Overflow",
  threshold_and_overflow: "Both",
};

export const CHAT_COMPACTION_POLICY_OPTIONS = (
  Object.entries(CHAT_COMPACTION_POLICY_LABELS) as Array<[ChatCompactionPolicy, string]>
).map(([value, label]) => ({ value, label }));

export const normalizeChatCompactionPolicy = (
  policy?: string | null,
  legacyAutoCompaction?: boolean | null,
): ChatCompactionPolicy => {
  if (policy && policy in CHAT_COMPACTION_POLICY_LABELS) {
    return policy as ChatCompactionPolicy;
  }

  if (legacyAutoCompaction === false) {
    return "off";
  }

  return "threshold_and_overflow";
};

export const getChatCompactionPolicyLabel = (policy: ChatCompactionPolicy): string =>
  CHAT_COMPACTION_POLICY_LABELS[policy];

export const getChatCompactionPolicyShortLabel = (policy: ChatCompactionPolicy): string =>
  CHAT_COMPACTION_POLICY_SHORT_LABELS[policy];

export const isAutoCompactionEnabled = (policy: ChatCompactionPolicy): boolean => policy !== "off";

export const isCompactionTriggerEnabled = (
  policy: ChatCompactionPolicy,
  trigger: AutoCompactionTrigger,
): boolean =>
  policy === "threshold_and_overflow" ||
  (policy === "threshold" && trigger === "threshold") ||
  (policy === "overflow" && trigger === "overflow");
