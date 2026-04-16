import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Minus,
  Plus,
  RefreshCw,
  Lock,
  Shield,
  ShieldAlert,
  X,
  ZoomIn,
} from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { Button } from "@/ui/button";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import Input from "@/ui/input";

interface WebViewerToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  canOpenDevTools: boolean;
  canOpenExternal: boolean;
  canCopyUrl: boolean;
  copied: boolean;
  devToolsTooltip: string;
  hasUrlError: boolean;
  inputUrl: string;
  isLoading: boolean;
  isLocalhost: boolean;
  isSecure: boolean;
  securityToneClass: string;
  securityTooltip: string;
  urlInputRef: RefObject<HTMLInputElement | null>;
  zoomLevel: number;
  onCopyUrl: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
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
  canGoBack,
  canGoForward,
  canOpenDevTools,
  canOpenExternal,
  canCopyUrl,
  copied,
  devToolsTooltip,
  hasUrlError,
  inputUrl,
  isLoading,
  isLocalhost,
  isSecure,
  securityToneClass,
  securityTooltip,
  urlInputRef,
  zoomLevel,
  onCopyUrl,
  onGoBack,
  onGoForward,
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
  const [showZoomPopover, setShowZoomPopover] = useState(false);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-border border-b bg-secondary-bg px-2">
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onGoBack}
          disabled={!canGoBack}
          tooltip="Go back"
        >
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onGoForward}
          disabled={!canGoForward}
          tooltip="Go forward"
        >
          <ArrowRight />
        </Button>
      </div>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <form onSubmit={onUrlSubmit} className="flex flex-1 items-center">
        <div className="relative flex flex-1 items-center">
          <div
            className={`absolute left-2.5 flex items-center ${securityToneClass}`}
            title={securityTooltip}
          >
            <SecurityIcon />
          </div>
          <Input
            ref={urlInputRef}
            type="text"
            value={inputUrl}
            onChange={(e) => onInputUrlChange(e.target.value)}
            placeholder="Enter URL..."
            className={`h-7 w-full rounded-md pr-20 pl-8 text-[13px] focus:ring-accent/30 ${
              hasUrlError
                ? "border-error/60 bg-error/5 focus:border-error"
                : "border-border bg-primary-bg focus:border-accent"
            }`}
          />
          <div className="absolute right-1.5 flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={isLoading ? onStopLoading : onRefresh}
              className="text-text-lighter hover:text-text"
              tooltip={isLoading ? "Stop loading" : "Refresh"}
            >
              {isLoading ? <X className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onCopyUrl}
              disabled={!canCopyUrl}
              className="text-text-lighter hover:text-text"
              tooltip="Copy URL"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </form>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <div className="flex items-center gap-0.5">
        <Button
          ref={zoomButtonRef}
          variant="ghost"
          size="icon-sm"
          onClick={() => setShowZoomPopover((open) => !open)}
          tooltip="Zoom controls"
        >
          <ZoomIn />
        </Button>
        <Dropdown
          isOpen={showZoomPopover}
          anchorRef={zoomButtonRef}
          anchorSide="bottom"
          anchorAlign="end"
          onClose={() => setShowZoomPopover(false)}
          className="w-[144px] overflow-hidden rounded-lg p-1.5"
        >
          <div className="space-y-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
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
              size="sm"
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
              size="sm"
              onClick={() => {
                onResetZoom();
                setShowZoomPopover(false);
              }}
              className={dropdownItemClassName("justify-between")}
            >
              <span>Reset zoom</span>
              <span className="text-text-lighter text-xs">{Math.round(zoomLevel * 100)}%</span>
            </Button>
          </div>
        </Dropdown>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenDevTools}
          disabled={!canOpenDevTools}
          tooltip={devToolsTooltip}
        >
          <Code2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenExternal}
          disabled={!canOpenExternal}
          tooltip="Open in browser"
        >
          <ExternalLink />
        </Button>
      </div>
    </div>
  );
}
