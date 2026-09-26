import type {
  ExtensionViewDiffLineType,
  ExtensionViewNode,
} from "@/extensions/ui/types/extension-view";
import { cn } from "@/utils/cn";

type ExtensionDiffNode = Extract<ExtensionViewNode, { type: "diff" }>;
type ExtensionDiffPreviewProps = Omit<ExtensionDiffNode, "type">;

const lineClassNames: Record<ExtensionViewDiffLineType, string> = {
  added: "bg-git-added-soft shadow-[inset_2px_0_0_var(--git-added)]",
  removed: "bg-git-deleted-soft shadow-[inset_2px_0_0_var(--git-deleted)]",
  context: "bg-background",
  header: "bg-surface text-subtle-foreground",
};

function lineMarker(type: ExtensionViewDiffLineType): string {
  if (type === "added") return "+";
  if (type === "removed") return "-";
  return " ";
}

export function ExtensionDiffPreview({
  filePath,
  oldPath,
  language,
  lines,
  truncated,
}: ExtensionDiffPreviewProps) {
  const additions = lines.filter((line) => line.type === "added").length;
  const deletions = lines.filter((line) => line.type === "removed").length;

  return (
    <figure
      data-slot="diff-preview"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-background"
      aria-label={`Diff for ${filePath}, ${additions} additions and ${deletions} deletions`}
    >
      <figcaption className="flex min-h-8 min-w-0 items-center gap-2 border-border border-b bg-surface px-2.5 py-1.5 ui-text-sm">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-foreground" title={filePath}>
            {filePath}
          </span>
          {oldPath && oldPath !== filePath ? (
            <span className="block truncate text-subtle-foreground" title={oldPath}>
              from {oldPath}
            </span>
          ) : null}
        </span>
        {additions > 0 ? (
          <span className="shrink-0 text-git-added tabular-nums">+{additions}</span>
        ) : null}
        {deletions > 0 ? (
          <span className="shrink-0 text-git-deleted tabular-nums">-{deletions}</span>
        ) : null}
      </figcaption>
      <div
        role="table"
        aria-label={`Changed lines in ${filePath}`}
        className="max-h-72 max-w-full select-text overflow-auto font-mono ui-text-sm"
        data-language={language}
      >
        {lines.map((line, index) => (
          <div
            key={`${line.type}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`}
            role="row"
            className={cn(
              "grid min-w-max grid-cols-[2.5rem_2.5rem_1.25rem_minmax(max-content,1fr)]",
              lineClassNames[line.type],
            )}
          >
            {line.type === "header" ? (
              <>
                <span
                  role="cell"
                  aria-hidden="true"
                  className="col-span-3 border-border border-r px-2 py-0.5 text-right text-subtle-foreground"
                >
                  @@
                </span>
                <code role="cell" className="px-2.5 py-0.5 text-subtle-foreground">
                  {line.content}
                </code>
              </>
            ) : (
              <>
                <span
                  role="cell"
                  aria-hidden="true"
                  className="select-none border-border border-r px-2 py-0.5 text-right text-subtle-foreground tabular-nums"
                >
                  {line.oldLine ?? ""}
                </span>
                <span
                  role="cell"
                  aria-hidden="true"
                  className="select-none border-border border-r px-2 py-0.5 text-right text-subtle-foreground tabular-nums"
                >
                  {line.newLine ?? ""}
                </span>
                <span
                  role="cell"
                  aria-hidden="true"
                  className={cn(
                    "select-none px-1 py-0.5 text-center",
                    line.type === "added" && "text-git-added",
                    line.type === "removed" && "text-git-deleted",
                    line.type === "context" && "text-subtle-foreground",
                  )}
                >
                  {lineMarker(line.type)}
                </span>
                <code role="cell" className="whitespace-pre px-1.5 py-0.5 text-foreground">
                  {line.content || " "}
                </code>
              </>
            )}
          </div>
        ))}
      </div>
      {truncated ? (
        <div className="border-border border-t bg-surface px-2.5 py-1.5 text-subtle-foreground ui-text-sm">
          Diff preview truncated
        </div>
      ) : null}
    </figure>
  );
}
