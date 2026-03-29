import type { QueuedMessage } from "@/features/ai/store/types";

export interface QueuedMessageCounts {
  steering: number;
  followUp: number;
  total: number;
}

export const getNextQueuedMessageIndex = (queue: QueuedMessage[]): number => {
  const steeringIndex = queue.findIndex((message) => message.kind === "steering");
  if (steeringIndex !== -1) {
    return steeringIndex;
  }

  return queue.findIndex((message) => message.kind === "follow-up");
};

export const getQueuedMessageCounts = (queue: QueuedMessage[]): QueuedMessageCounts => {
  return queue.reduce<QueuedMessageCounts>(
    (counts, message) => {
      if (message.kind === "steering") {
        counts.steering += 1;
      } else {
        counts.followUp += 1;
      }
      counts.total += 1;
      return counts;
    },
    { steering: 0, followUp: 0, total: 0 },
  );
};
