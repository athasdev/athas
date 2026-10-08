import { commands } from "@/bindings/commands";
import type { ReleaseInput } from "../types/github-delivery.types";

export const saveRelease = (repoPath: string, id: number | null, input: ReleaseInput) =>
  commands.githubSaveRelease(repoPath, id, input);

export const publishRelease = (repoPath: string, id: number, makeLatest: boolean) =>
  commands.githubPublishRelease(repoPath, id, makeLatest);

export const deleteRelease = (repoPath: string, id: number) =>
  commands.githubDeleteRelease(repoPath, id);

export const generateReleaseNotes = (
  repoPath: string,
  tag: string,
  target: string,
  previousTag: string | null,
) => commands.githubGenerateReleaseNotes(repoPath, tag, target, previousTag);

export const uploadReleaseAsset = (repoPath: string, releaseId: number, filePath: string) =>
  commands.githubUploadReleaseAsset(repoPath, releaseId, filePath);

export const deleteReleaseAsset = (repoPath: string, assetId: number) =>
  commands.githubDeleteReleaseAsset(repoPath, assetId);

export const deactivateDeployment = (repoPath: string, id: number) =>
  commands.githubDeactivateDeployment(repoPath, id);
