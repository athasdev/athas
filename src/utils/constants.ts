// Key increment helper for forcing React re-renders
export const incrementKey = (key: number): number => (key + 1) % Number.MAX_SAFE_INTEGER;
