export interface BufferSwitchTransitionInput {
  hasInitialized: boolean;
  previousBufferId: string | null;
  previousViewKey: string | null;
  nextBufferId: string;
  nextViewKey: string;
  hasCachedViewState: boolean;
}

export function shouldRestoreBufferSwitchState({
  hasInitialized,
  previousBufferId,
  previousViewKey,
  nextBufferId,
  nextViewKey,
  hasCachedViewState,
}: BufferSwitchTransitionInput): boolean {
  if (!hasInitialized) {
    return hasCachedViewState;
  }

  return previousBufferId !== nextBufferId || previousViewKey !== nextViewKey;
}
