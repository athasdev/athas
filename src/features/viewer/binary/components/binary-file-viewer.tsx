import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";
import { ViewerFooter } from "@/features/viewer/components/viewer-footer";
import { ViewerHeader } from "@/features/viewer/components/viewer-header";
import { ViewerLayout } from "@/features/viewer/components/viewer-layout";
import { ViewerErrorState, ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { FileIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { formatFileSize } from "@/utils/format-file-size";
import { cn } from "@/utils/cn";
import { getRelativePath } from "@/utils/path-helpers";
import type { BinaryMetadata } from "../lib/binary-metadata";
import { getBinaryMetadata } from "../lib/binary-metadata";

interface BinaryFileViewerProps {
  filePath: string;
  fileName: string;
  rootFolderPath?: string;
}

export function BinaryFileViewer({ filePath, fileName, rootFolderPath }: BinaryFileViewerProps) {
  const [metadata, setMetadata] = useState<BinaryMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ext = fileName.split(".").pop()?.toUpperCase() || "";
  const relativePath = getRelativePath(filePath, rootFolderPath);

  useEffect(() => {
    const loadMetadata = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await readFile(filePath);
        setMetadata(getBinaryMetadata(data, filePath));
      } catch (err) {
        setError(`Failed to read file: ${err}`);
      } finally {
        setLoading(false);
      }
    };

    loadMetadata();
  }, [filePath]);

  if (loading) {
    return <ViewerLoadingState label="Loading binary file" />;
  }

  if (error || !metadata) {
    return <ViewerErrorState message={error || "Failed to load file"} />;
  }

  return (
    <ViewerLayout className="flex flex-col">
      <ViewerHeader
        icon={<FileIcon className="shrink-0 text-foreground" />}
        title={
          <span title={fileName}>
            {fileName} {ext && <>&#8226; {ext}</>}
          </span>
        }
        detail={metadata.fileType}
      />

      <ScrollArea className="min-h-0 flex-1" contentClassName="p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <Card className="gap-0 border-border/60 py-0">
            <CardHeader className="border-border/40 border-b py-2.5">
              <CardTitle>File Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 py-4">
              <InfoRow label="Type" value={metadata.fileType} />
              <InfoRow label="Size" value={formatFileSize(metadata.fileSize)} />
              <InfoRow label="Extension" value={`.${ext.toLowerCase()}`} />
              <InfoRow label="Path" value={relativePath} />
            </CardContent>
          </Card>

          {metadata.wasmMetadata && (
            <Card className="gap-0 border-border/60 py-0">
              <CardHeader className="border-border/40 border-b py-2.5">
                <CardTitle>WebAssembly Module</CardTitle>
              </CardHeader>
              <CardContent className="py-4">
                <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2">
                  <InfoRow label="WASM Version" value={`${metadata.wasmMetadata.version}`} />
                  <InfoRow label="Sections" value={`${metadata.wasmMetadata.sections.length}`} />
                </div>

                {metadata.wasmMetadata.sections.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-md border border-border/40">
                    <Table>
                      <TableHeader className="static bg-background/50">
                        <TableRow>
                          <TableHead className="px-3 font-normal">Section</TableHead>
                          <TableHead className="px-3 text-right font-normal">Size</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {metadata.wasmMetadata.sections.map((section, i) => (
                          <TableRow
                            key={`${section.id}-${i}`}
                            className={cn(
                              "border-border/20 border-b last:border-b-0",
                              i % 2 === 0 ? "bg-transparent" : "bg-background/30",
                            )}
                          >
                            <TableCell className="px-3">{section.name}</TableCell>
                            <TableCell className="px-3 text-right text-subtle-foreground tabular-nums">
                              {formatFileSize(section.size)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="gap-0 border-border/60 py-0">
            <CardHeader className="border-border/40 border-b py-2.5">
              <CardTitle>Hex Preview</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto py-4">
              <pre className="ui-text-sm font-mono text-subtle-foreground leading-4.5">
                {metadata.hexPreview}
              </pre>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      <ViewerFooter
        endContent={
          <span className="truncate" title={relativePath}>
            {relativePath}
          </span>
        }
      >
        <span>{metadata.fileType}</span>
        <span>{formatFileSize(metadata.fileSize)}</span>
      </ViewerFooter>
    </ViewerLayout>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-sans ui-text-sm shrink-0 text-subtle-foreground">{label}</span>
      <span className="font-sans ui-text-sm min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}
