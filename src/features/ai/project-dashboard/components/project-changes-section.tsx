import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { FileGlyph, StatusLetter } from "@/features/git/stream/stream-primitives";
import { useGitStore } from "@/features/git/stores/git.store";
import { openWorkingTreeDiffBuffer } from "@/features/git/services/open-working-tree-diff-buffer";
import { Button } from "@/ui/button";
import { GroupedSection } from "@/ui/grouped-section";
import { SidebarListItem } from "@/ui/sidebar";

const SHOWN_FILES = 8;

/** The project's uncommitted work: what changed, and one click to review it as a diff. */
export function ProjectChangesSection({ projectPath }: { projectPath: string }) {
  const status = useGitStore((state) => state.workspaceGitStatus);
  const files = status?.files ?? [];
  const staged = files.filter((file) => file.staged).length;
  const openFile = (path: string) =>
    void useFileSystemStore.getState().handleFileSelect(`${projectPath}/${path}`, false);

  if (!status) return null;

  return (
    <GroupedSection
      title="Changes"
      description={
        files.length === 0
          ? "Working tree clean"
          : `${files.length} file${files.length === 1 ? "" : "s"}${staged ? ` · ${staged} staged` : ""}`
      }
      actions={
        files.length > 0 ? (
          <Button
            variant="ghost"
            onClick={() => openWorkingTreeDiffBuffer({ repoPath: projectPath, files })}
          >
            Review
          </Button>
        ) : null
      }
      variant="flat"
    >
      {files.slice(0, SHOWN_FILES).map((file) => (
        <SidebarListItem
          key={`${file.staged ? "staged" : "unstaged"}:${file.path}`}
          leading={<FileGlyph name={file.path.split("/").pop() ?? file.path} />}
          trailing={<StatusLetter status={file.status} />}
          title={file.path}
          onClick={() => openFile(file.path)}
        >
          {file.path}
        </SidebarListItem>
      ))}
      {files.length > SHOWN_FILES ? (
        <SidebarListItem as="div" interactive={false}>
          {files.length - SHOWN_FILES} more
        </SidebarListItem>
      ) : null}
    </GroupedSection>
  );
}
