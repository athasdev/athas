import type { MessageUsage } from "@/features/ai/types/ai-chat.types";

/**
 * The cost and step count of a built-in agent turn for the message footer, such as
 * "4 steps · $0.03"; tokens already show through the turn usage. Null when there is nothing
 * worth showing.
 */
export function formatMessageUsage(usage: MessageUsage, locale?: string): string | null {
  const parts: string[] = [];
  if (usage.steps !== undefined && usage.steps > 1) parts.push(`${usage.steps} steps`);
  if (usage.costCents !== undefined && usage.costCents > 0) {
    parts.push(
      usage.costCents < 1
        ? "<$0.01"
        : new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(
            usage.costCents / 100,
          ),
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
