import { useEffect, useMemo, useRef, useState } from "react";
import { getCommitDiff, getStatusDiffStats } from "@/features/git/api/git-diff-api";
import { useGitDataController } from "@/features/git/hooks/use-git-data-controller";
import { useGitStore } from "@/features/git/stores/git.store";
import type { GitDiff, GitDiffStat } from "@/features/git/types/git.types";
import {
  createCommitChangeSet,
  createWorkingTreeChangeSet,
  createWorkingTreeFingerprint,
  EMPTY_PROJECT_REVIEW_STATE,
  getPendingCommits,
} from "../lib/review-model";
import { useReviewStore } from "../stores/review.store";
import type { ReviewChangeSet } from "../types/review.types";

const TIMELINE_COMMIT_LIMIT = 12;

export function useReviewChangeSets(workspacePath?: string | null) {
  const { activeRepoPath, refresh } = useGitDataController({
    workspacePath,
    isActive: true,
  });
  const gitStatus = useGitStore((state) => state.gitStatus);
  const commits = useGitStore((state) => state.commits);
  const isLoadingGitData = useGitStore((state) => state.isLoadingGitData);
  const projectState = useReviewStore((state) =>
    activeRepoPath ? (state.projects[activeRepoPath] ?? EMPTY_PROJECT_REVIEW_STATE) : null,
  );
  const [workingTreeStats, setWorkingTreeStats] = useState<GitDiffStat[]>([]);
  const [commitDiffs, setCommitDiffs] = useState<Record<string, GitDiff[]>>({});
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!activeRepoPath || projectState?.reviewedThroughHash || commits.length === 0) return;
    const baselineCommit = commits[Math.min(gitStatus?.ahead ?? 0, commits.length - 1)];
    if (baselineCommit) {
      useReviewStore.getState().actions.establishBaseline(activeRepoPath, baselineCommit.hash);
    }
  }, [activeRepoPath, commits, gitStatus?.ahead, projectState?.reviewedThroughHash]);

  const pendingCommits = useMemo(
    () =>
      getPendingCommits({
        commits,
        ahead: gitStatus?.ahead ?? 0,
        projectState: projectState ?? EMPTY_PROJECT_REVIEW_STATE,
      }),
    [commits, gitStatus?.ahead, projectState],
  );

  const commitsToLoad = useMemo(() => {
    const byHash = new Map(
      [...pendingCommits, ...commits.slice(0, TIMELINE_COMMIT_LIMIT)].map((commit) => [
        commit.hash,
        commit,
      ]),
    );
    return [...byHash.values()].slice(0, 24);
  }, [commits, pendingCommits]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!activeRepoPath) {
      setWorkingTreeStats([]);
      setCommitDiffs({});
      return;
    }

    setWorkingTreeStats([]);
    setCommitDiffs({});
    setIsLoadingDetails(true);
    void Promise.all([
      getStatusDiffStats(activeRepoPath),
      Promise.all(
        commitsToLoad.map(
          async (commit) =>
            [commit.hash, (await getCommitDiff(activeRepoPath, commit.hash)) ?? []] as const,
        ),
      ),
    ])
      .then(([stats, diffs]) => {
        if (requestIdRef.current !== requestId) return;
        setWorkingTreeStats(stats);
        setCommitDiffs(Object.fromEntries(diffs));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setIsLoadingDetails(false);
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [activeRepoPath, commitsToLoad]);

  const fingerprint = useMemo(
    () => createWorkingTreeFingerprint(gitStatus, workingTreeStats),
    [gitStatus, workingTreeStats],
  );

  const workingTreeChangeSet = useMemo(() => {
    if (!gitStatus || !fingerprint) return null;
    return createWorkingTreeChangeSet({
      status: gitStatus,
      stats: workingTreeStats,
      fingerprint,
      reviewed: projectState?.reviewedWorkingTreeFingerprint === fingerprint,
    });
  }, [fingerprint, gitStatus, projectState?.reviewedWorkingTreeFingerprint, workingTreeStats]);

  const pendingHashes = useMemo(
    () => new Set(pendingCommits.map((commit) => commit.hash)),
    [pendingCommits],
  );
  const timelineChangeSets = useMemo<ReviewChangeSet[]>(() => {
    const commitSets = commits
      .slice(0, TIMELINE_COMMIT_LIMIT)
      .map((commit) =>
        createCommitChangeSet(
          commit,
          commitDiffs[commit.hash] ?? [],
          !pendingHashes.has(commit.hash),
        ),
      );
    return workingTreeChangeSet ? [workingTreeChangeSet, ...commitSets] : commitSets;
  }, [commitDiffs, commits, pendingHashes, workingTreeChangeSet]);
  const queueChangeSets = useMemo<ReviewChangeSet[]>(() => {
    const pending = pendingCommits.map((commit) =>
      createCommitChangeSet(commit, commitDiffs[commit.hash] ?? [], false),
    );
    return workingTreeChangeSet && !workingTreeChangeSet.reviewed
      ? [workingTreeChangeSet, ...pending]
      : pending;
  }, [commitDiffs, pendingCommits, workingTreeChangeSet]);

  return {
    activeRepoPath,
    gitStatus,
    commits,
    projectState: projectState ?? EMPTY_PROJECT_REVIEW_STATE,
    fingerprint,
    queueChangeSets,
    timelineChangeSets,
    isLoading: isLoadingGitData || isLoadingDetails,
    refresh,
  };
}
