import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import { getCommitFileContent } from "../api/git-diff-api";

interface OpenCommitFileBufferOptions {
  repoPath: string;
  commitHash: string;
  filePath: string;
}

export async function openCommitFileBuffer({
  repoPath,
  commitHash,
  filePath,
}: OpenCommitFileBufferOptions): Promise<string> {
  const content = await getCommitFileContent(repoPath, commitHash, filePath);
  const fileName = filePath.split("/").pop() || filePath;
  const shortHash = commitHash.slice(0, 7);

  return useBufferStore.getState().actions.openContent({
    type: "editor",
    path: `git://${commitHash}/${filePath}`,
    name: `${fileName} (${shortHash})`,
    content,
    isVirtual: true,
    readOnly: true,
    language: getLanguageIdFromPath(filePath) ?? undefined,
  });
}
