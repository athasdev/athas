import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";
import { ViewerFooter } from "@/features/viewer/components/viewer-footer";
import { ViewerHeader } from "@/features/viewer/components/viewer-header";
import { ViewerLayout } from "@/features/viewer/components/viewer-layout";
import { ViewerErrorState, ViewerLoadingState } from "@/features/viewer/components/viewer-state";
import { FileIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
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
        icon={<FileIcon className="shrink-0 text-text" />}
        title={
          <span title={fileName}>
            {fileName} {ext && <>&#8226; {ext}</>}
          </span>
        }
        detail={metadata.fileType}
      />

      <ScrollArea className="min-h-0 flex-1" contentClassName="p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* File Info Card */}
          <div className="rounded-xl border border-border/60 bg-secondary-bg">
            <div className="border-border/40 border-b px-4 py-2.5">
              <span className="font-sans ui-text-sm font-medium text-text">File Information</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-4">
              <InfoRow label="Type" value={metadata.fileType} />
              <InfoRow label="Size" value={formatFileSize(metadata.fileSize)} />
              <InfoRow label="Extension" value={`.${ext.toLowerCase()}`} />
              <InfoRow label="Path" value={relativePath} />
            </div>
          </div>

          {/* WASM Metadata */}
          {metadata.wasmMetadata && (
            <div className="rounded-xl border border-border/60 bg-secondary-bg">
              <div className="border-border/40 border-b px-4 py-2.5">
                <span className="font-sans ui-text-sm font-medium text-text">
                  WebAssembly Module
                </span>
              </div>
              <div className="p-4">
                <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2">
                  <InfoRow label="WASM Version" value={`${metadata.wasmMetadata.version}`} />
                  <InfoRow label="Sections" value={`${metadata.wasmMetadata.sections.length}`} />
                </div>

                {metadata.wasmMetadata.sections.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-md border border-border/40">
                    <table className="w-full">
                      <thead>
                        <tr className="border-border/40 border-b bg-primary-bg/50">
                          <th className="font-sans ui-text-sm px-3 py-1.5 text-left font-normal text-text-lighter">
                            Section
                          </th>
                          <th className="font-sans ui-text-sm px-3 py-1.5 text-right font-normal text-text-lighter">
                            Size
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {metadata.wasmMetadata.sections.map((section, i) => (
                          <tr
                            key={`${section.id}-${i}`}
                            className={cn(
                              "border-border/20 border-b last:border-b-0",
                              i % 2 === 0 ? "bg-transparent" : "bg-primary-bg/30",
                            )}
                          >
                            <td className="font-sans ui-text-sm px-3 py-1.5 text-text">
                              {section.name}
                            </td>
                            <td className="font-sans ui-text-sm px-3 py-1.5 text-right text-text-lighter tabular-nums">
                              {formatFileSize(section.size)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hex Preview */}
          <div className="rounded-xl border border-border/60 bg-secondary-bg">
            <div className="border-border/40 border-b px-4 py-2.5">
              <span className="font-sans ui-text-sm font-medium text-text">Hex Preview</span>
            </div>
            <div className="overflow-auto p-4">
              <pre className="ui-text-sm font-mono text-text-lighter leading-[18px]">
                {metadata.hexPreview}
              </pre>
            </div>
          </div>
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
      <span className="font-sans ui-text-sm shrink-0 text-text-lighter">{label}</span>
      <span className="font-sans ui-text-sm min-w-0 truncate text-text">{value}</span>
    </div>
  );
}
