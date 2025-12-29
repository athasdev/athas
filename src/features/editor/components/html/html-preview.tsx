import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";

export function HtmlPreview() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);

  // If this is a preview buffer, find the source buffer
  const sourceBuffer = activeBuffer?.sourceFilePath
    ? buffers.find((b) => b.path === activeBuffer.sourceFilePath)
    : activeBuffer;

  const [iframeContent, setIframeContent] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize the asset URL for the directory
  const assetBaseUrl = useMemo(() => {
    if (!sourceBuffer?.path) return "";

    // Get directory path
    const lastSlashIndex = sourceBuffer.path.lastIndexOf("/");
    const dirPath =
      lastSlashIndex !== -1 ? sourceBuffer.path.substring(0, lastSlashIndex) : sourceBuffer.path;

    // Convert to Tauri asset URL
    // convertFileSrc handles the protocol logic (e.g. asset:// or http://asset.localhost)
    const url = convertFileSrc(dirPath);

    // Ensure it ends with slash for correct base resolution
    return url.endsWith("/") ? url : `${url}/`;
  }, [sourceBuffer?.path]);

  useEffect(() => {
    if (!sourceBuffer) return;

    let content = sourceBuffer.content;

    // Inject <base> tag to allow relative links (CSS/JS/Images) to work
    if (assetBaseUrl) {
      const baseTag = `<base href="${assetBaseUrl}">`;

      // Try to inject in head
      if (content.includes("<head>")) {
        content = content.replace("<head>", `<head>\n${baseTag}`);
      } else if (content.includes("<html>")) {
        content = content.replace("<html>", `<html>\n<head>${baseTag}</head>`);
      } else {
        // No head/html tags, just prepend
        content = `${baseTag}\n${content}`;
      }
    }

    // Add script to handle errors and console logs if needed in future
    // For now keeping it simple with just content rendering
    setIframeContent(content);
  }, [sourceBuffer?.content, assetBaseUrl]);

  if (!sourceBuffer) {
    return (
      <div className="flex h-full items-center justify-center text-text-lighter">
        No active buffer
      </div>
    );
  }

  return (
    <div ref={containerRef} className="html-preview h-full w-full bg-white">
      <iframe
        title="HTML Preview"
        srcDoc={iframeContent}
        className="h-full w-full border-none"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
