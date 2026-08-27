import type { BufferSession } from "@/features/workspace/types/workspace-session.types";

interface DeferredWorkspaceSessionRestoreOptions {
  pendingBuffers: BufferSession[];
  waitForIdle: () => Promise<void>;
  shouldContinue: () => boolean;
  restoreBuffer: (buffer: BufferSession) => Promise<void>;
  onBufferError: (buffer: BufferSession, error: unknown) => void;
  afterBufferRestored: (buffer: BufferSession) => void;
}

interface DeferredWorkspaceSessionRestoreResult {
  completed: boolean;
  restoredBufferCount: number;
}

export async function drainDeferredWorkspaceSessionBuffers({
  pendingBuffers,
  waitForIdle,
  shouldContinue,
  restoreBuffer,
  onBufferError,
  afterBufferRestored,
}: DeferredWorkspaceSessionRestoreOptions): Promise<DeferredWorkspaceSessionRestoreResult> {
  let restoredBufferCount = 0;

  while (pendingBuffers.length > 0) {
    await waitForIdle();
    if (!shouldContinue()) {
      return { completed: false, restoredBufferCount };
    }

    const nextBuffer = pendingBuffers[0];
    if (!nextBuffer) {
      break;
    }

    try {
      await restoreBuffer(nextBuffer);
    } catch (error) {
      onBufferError(nextBuffer, error);
    }

    pendingBuffers.shift();
    restoredBufferCount++;
    afterBufferRestored(nextBuffer);
  }

  return {
    completed: pendingBuffers.length === 0,
    restoredBufferCount,
  };
}
