type ContextBufferCandidate = { type?: string | null };

export const isContextEligibleBuffer = (buffer: ContextBufferCandidate): boolean =>
  buffer.type !== "agent";
