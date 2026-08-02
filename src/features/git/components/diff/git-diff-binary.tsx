import { FileIcon } from "@/ui/icons";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";

export function BinaryDiffViewer({ fileName }: { fileName: string }) {
  return (
    <Empty className="min-h-40 rounded-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileIcon />
        </EmptyMedia>
        <EmptyTitle>Binary file changed</EmptyTitle>
        <EmptyDescription>{fileName} cannot be displayed as a text diff.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
