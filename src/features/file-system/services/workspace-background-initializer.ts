type WorkspaceBackgroundInitializationStep = "backgroundInit" | "setProjectRoot" | "getGitStatus";

type WorkspaceBackgroundInitializationPhase = "start" | "end" | "error";

interface WorkspaceGitStatusSnapshot {
  repoPath: string | null;
  updatedAt: number;
}

export interface WorkspaceBackgroundInitializationOptions<TGitStatus> {
  path: string;
  deferWatcher?: boolean;
  preserveGitStatus?: boolean;
  maxGitStatusAgeMs?: number;
  waitForIdle: () => Promise<void>;
  canContinue: () => boolean;
  canCommitGitStatus: () => boolean;
  shouldResetGitStatusAfterError: () => boolean;
  resetGitStatus: () => void;
  setProjectRoot: () => Promise<void>;
  startFileSearchSync: () => void;
  getGitStatusSnapshot: () => WorkspaceGitStatusSnapshot;
  readGitStatus: () => Promise<TGitStatus>;
  commitGitStatus: (status: TGitStatus) => void;
  trace: (
    phase: WorkspaceBackgroundInitializationPhase,
    step: WorkspaceBackgroundInitializationStep,
    startedAt?: number,
  ) => void;
  onError: (error: unknown) => void;
  getMonotonicTime?: () => number;
  getWallTime?: () => number;
}

export type WorkspaceBackgroundInitializationResult =
  | "completed"
  | "cancelled"
  | "cached"
  | "failed";

export interface WorkspaceBackgroundInitializer {
  invalidate: () => void;
  start: <TGitStatus>(
    options: WorkspaceBackgroundInitializationOptions<TGitStatus>,
  ) => Promise<WorkspaceBackgroundInitializationResult>;
}

export function createWorkspaceBackgroundInitializer(): WorkspaceBackgroundInitializer {
  let currentActivation = 0;

  return {
    invalidate() {
      currentActivation++;
    },

    start<TGitStatus>(options: WorkspaceBackgroundInitializationOptions<TGitStatus>) {
      const activation = ++currentActivation;
      const isCurrent = () => activation === currentActivation;
      const getMonotonicTime = options.getMonotonicTime ?? (() => performance.now());
      const getWallTime = options.getWallTime ?? (() => Date.now());

      if (!options.preserveGitStatus) {
        options.resetGitStatus();
      }

      return (async () => {
        const backgroundStartedAt = getMonotonicTime();
        options.trace("start", "backgroundInit");

        try {
          if (options.deferWatcher) {
            await options.waitForIdle();
          }
          if (!isCurrent() || !options.canContinue()) {
            return "cancelled";
          }

          const watcherStartedAt = getMonotonicTime();
          options.trace("start", "setProjectRoot");
          await options.setProjectRoot();
          options.trace("end", "setProjectRoot", watcherStartedAt);

          await options.waitForIdle();
          if (!isCurrent() || !options.canContinue()) {
            return "cancelled";
          }

          options.startFileSearchSync();

          await options.waitForIdle();
          if (!isCurrent() || !options.canContinue()) {
            return "cancelled";
          }

          const gitSnapshot = options.getGitStatusSnapshot();
          if (
            options.preserveGitStatus &&
            gitSnapshot.repoPath === options.path &&
            getWallTime() - gitSnapshot.updatedAt < (options.maxGitStatusAgeMs ?? 15_000)
          ) {
            options.trace("end", "backgroundInit", backgroundStartedAt);
            return "cached";
          }

          const gitStatusStartedAt = getMonotonicTime();
          options.trace("start", "getGitStatus");
          const gitStatus = await options.readGitStatus();
          options.trace("end", "getGitStatus", gitStatusStartedAt);

          if (!isCurrent() || !options.canCommitGitStatus()) {
            return "cancelled";
          }

          options.commitGitStatus(gitStatus);
          options.trace("end", "backgroundInit", backgroundStartedAt);
          return "completed";
        } catch (error) {
          if (options.shouldResetGitStatusAfterError()) {
            options.resetGitStatus();
          }
          options.trace("error", "backgroundInit", backgroundStartedAt);
          options.onError(error);
          return "failed";
        }
      })();
    },
  };
}
