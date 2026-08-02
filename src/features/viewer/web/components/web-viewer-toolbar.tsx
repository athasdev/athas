import {
  CheckIcon as Check,
  CodeIcon as Code2,
  CopyIcon as Copy,
  ArrowSquareOutIcon as ExternalLink,
  BroomIcon as Broom,
  MinusIcon as Minus,
  PlusIcon as Plus,
  ArrowClockwiseIcon as RefreshCw,
  LockIcon as Lock,
  ShieldIcon as Shield,
  ShieldWarningIcon as ShieldAlert,
  XIcon as X,
  MagnifyingGlassPlusIcon as ZoomIn,
} from "@/ui/icons";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/ui/button";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import { readClipboardText, writeClipboardText } from "@/utils/clipboard";

interface WebViewerToolbarProps {
  canOpenDevTools: boolean;
  canOpenExternal: boolean;
  canCopyUrl: boolean;
  canClearBrowsingData: boolean;
  copied: boolean;
  devToolsTooltip: string;
  favicon?: string | null;
  hasUrlError: boolean;
  inputUrl: string;
  isLoading: boolean;
  isLocalhost: boolean;
  isSecure: boolean;
  securityToneClass: string;
  securityTooltip: string;
  urlInputRef: RefObject<HTMLInputElement | null>;
  zoomLevel: number;
  onClearBrowsingData: () => void;
  onCopyUrl: () => void;
  onInputUrlChange: (value: string) => void;
  onOpenDevTools: () => void;
  onOpenExternal: () => void;
  onRefresh: () => void;
  onResetZoom: () => void;
  onStopLoading: () => void;
  onUrlSubmit: (event: React.FormEvent) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function WebViewerToolbar({
  canOpenDevTools,
  canOpenExternal,
  canCopyUrl,
  canClearBrowsingData,
  copied,
  devToolsTooltip,
  favicon,
  hasUrlError,
  inputUrl,
  isLoading,
  isLocalhost,
  isSecure,
  securityToneClass,
  securityTooltip,
  urlInputRef,
  zoomLevel,
  onClearBrowsingData,
  onCopyUrl,
  onInputUrlChange,
  onOpenDevTools,
  onOpenExternal,
  onRefresh,
  onResetZoom,
  onStopLoading,
  onUrlSubmit,
  onZoomIn,
  onZoomOut,
}: WebViewerToolbarProps) {
  const SecurityIcon = isLocalhost ? Shield : isSecure ? Lock : ShieldAlert;
  const [faviconFailed, setFaviconFailed] = useState(false);
  const [showZoomPopover, setShowZoomPopover] = useState(false);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const showFavicon = Boolean(favicon) && !faviconFailed;

  useEffect(() => {
    setFaviconFailed(false);
  }, [favicon]);

  const restoreSelection = (input: HTMLInputElement, start: number, end = start) => {
    requestAnimationFrame(() => {
      input.setSelectionRange(start, end);
    });
  };

  const handleUrlInputKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod || event.altKey) return;

    const input = event.currentTarget;
    const key = event.key.toLowerCase();
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const selectedText = input.value.slice(selectionStart, selectionEnd);

    if (key === "a") {
      event.preventDefault();
      event.stopPropagation();
      input.select();
      return;
    }

    if (key === "c" && selectedText) {
      event.preventDefault();
      event.stopPropagation();
      await writeClipboardText(selectedText);
      return;
    }

    if (key === "x" && selectedText) {
      event.preventDefault();
      event.stopPropagation();
      await writeClipboardText(selectedText);
      const nextValue = `${input.value.slice(0, selectionStart)}${input.value.slice(selectionEnd)}`;
      onInputUrlChange(nextValue);
      restoreSelection(input, selectionStart);
      return;
    }

    if (key === "v") {
      event.preventDefault();
      event.stopPropagation();
      const pastedText = await readClipboardText();
      const nextValue = `${input.value.slice(0, selectionStart)}${pastedText}${input.value.slice(
        selectionEnd,
      )}`;
      onInputUrlChange(nextValue);
      restoreSelection(input, selectionStart + pastedText.length);
    }
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-border border-b bg-background px-2">
      <form onSubmit={onUrlSubmit} className="flex flex-1 items-center">
        <InputGroup
          className={`h-6 flex-1 bg-background ${
            hasUrlError ? "border-destructive/60 bg-destructive/5" : "border-border"
          }`}
          aria-invalid={hasUrlError || undefined}
        >
          <InputGroupAddon
            className={`pl-2 ${showFavicon ? "" : securityToneClass}`}
            title={securityTooltip}
          >
            {showFavicon ? (
              <img
                src={favicon ?? undefined}
                alt=""
                className="size-4 rounded-sm object-contain"
                onError={() => setFaviconFailed(true)}
              />
            ) : (
              <SecurityIcon className="size-4" />
            )}
          </InputGroupAddon>
          <InputGroupInput
            ref={urlInputRef}
            type="text"
            value={inputUrl}
            onChange={(e) => onInputUrlChange(e.target.value)}
            onKeyDown={handleUrlInputKeyDown}
            placeholder="Enter URL..."
            size="xs"
            className="h-full"
          />
          <InputGroupAddon align="inline-end" className="gap-0.5 pr-1">
            <InputGroupButton
              type="button"
              variant="ghost"
              onClick={isLoading ? onStopLoading : onRefresh}
              tooltip={isLoading ? "Stop loading" : "Refresh"}
              size="icon-xs"
            >
              {isLoading ? <X className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            </InputGroupButton>
            <InputGroupButton
              type="button"
              variant="ghost"
              onClick={onCopyUrl}
              disabled={!canCopyUrl}
              tooltip="Copy URL"
              size="icon-xs"
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>

      <div className="mx-1.5 h-4 w-px bg-border" />

      <div className="flex items-center gap-0.5">
        <Button
          ref={zoomButtonRef}
          variant="ghost"
          onClick={() => setShowZoomPopover((open) => !open)}
          tooltip="Zoom controls"
          size="icon-xs"
        >
          <ZoomIn />
        </Button>
        <Dropdown
          isOpen={showZoomPopover}
          anchorRef={zoomButtonRef}
          anchorSide="bottom"
          anchorAlign="end"
          onClose={() => setShowZoomPopover(false)}
          className="w-36 overflow-hidden rounded-lg p-1.5"
        >
          <div className="space-y-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onZoomIn();
                setShowZoomPopover(false);
              }}
              disabled={zoomLevel >= 3}
              className={dropdownItemClassName("justify-between")}
            >
              <span>Zoom in</span>
              <Plus className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onZoomOut();
                setShowZoomPopover(false);
              }}
              disabled={zoomLevel <= 0.25}
              className={dropdownItemClassName("justify-between")}
            >
              <span>Zoom out</span>
              <Minus className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onResetZoom();
                setShowZoomPopover(false);
              }}
              className={dropdownItemClassName("justify-between")}
            >
              <span>Reset zoom</span>
              <span className="text-subtle-foreground ui-text-sm">
                {Math.round(zoomLevel * 100)}%
              </span>
            </Button>
          </div>
        </Dropdown>
        <Button
          variant="ghost"
          onClick={onClearBrowsingData}
          disabled={!canClearBrowsingData}
          tooltip="Clear browsing data"
          size="icon-xs"
        >
          <Broom />
        </Button>
        <Button
          variant="ghost"
          onClick={onOpenDevTools}
          disabled={!canOpenDevTools}
          tooltip={devToolsTooltip}
          size="icon-xs"
        >
          <Code2 />
        </Button>
        <Button
          variant="ghost"
          onClick={onOpenExternal}
          disabled={!canOpenExternal}
          tooltip="Open in browser"
          size="icon-xs"
        >
          <ExternalLink />
        </Button>
      </div>
    </div>
  );
}
