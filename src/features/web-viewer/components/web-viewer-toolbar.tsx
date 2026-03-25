import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Home,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  X,
} from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { WebViewerToolbarButton } from "./web-viewer-toolbar-button";

interface WebViewerToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  copied: boolean;
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
  onHome: () => void;
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
  copied,
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
  onHome,
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

  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-border border-b bg-secondary-bg px-2">
      <div className="flex items-center gap-0.5">
        <WebViewerToolbarButton
          onClick={onGoBack}
          disabled={!canGoBack}
          title="Go back"
          aria-label="Go back"
        >
          <ArrowLeft />
        </WebViewerToolbarButton>
        <WebViewerToolbarButton
          onClick={onGoForward}
          disabled={!canGoForward}
          title="Go forward"
          aria-label="Go forward"
        >
          <ArrowRight />
        </WebViewerToolbarButton>
        <WebViewerToolbarButton
          onClick={isLoading ? onStopLoading : onRefresh}
          title={isLoading ? "Stop loading" : "Refresh"}
          aria-label={isLoading ? "Stop loading" : "Refresh"}
        >
          {isLoading ? <X /> : <RefreshCw />}
        </WebViewerToolbarButton>
        <WebViewerToolbarButton onClick={onHome} title="Go to home" aria-label="Go to home">
          <Home />
        </WebViewerToolbarButton>
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
            className="h-7 w-full rounded-md border-border bg-primary-bg pr-8 pl-8 text-[13px] focus:border-accent focus:ring-accent/30"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCopyUrl}
            className="absolute right-1.5 text-text-lighter hover:text-text"
            title="Copy URL"
            aria-label="Copy URL"
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
        </div>
      </form>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <div className="flex items-center gap-0.5">
        <WebViewerToolbarButton
          onClick={onZoomOut}
          disabled={zoomLevel <= 0.25}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus />
        </WebViewerToolbarButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onResetZoom}
          className="min-w-[44px] px-1.5 text-[11px] text-text-light"
          title="Reset zoom (click to reset)"
          aria-label="Reset zoom"
        >
          {Math.round(zoomLevel * 100)}%
        </Button>
        <WebViewerToolbarButton
          onClick={onZoomIn}
          disabled={zoomLevel >= 3}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus />
        </WebViewerToolbarButton>
      </div>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <div className="flex items-center gap-0.5">
        <WebViewerToolbarButton
          onClick={onOpenDevTools}
          title="Open Developer Tools"
          aria-label="Open Developer Tools"
        >
          <Code2 />
        </WebViewerToolbarButton>
        <WebViewerToolbarButton
          onClick={onOpenExternal}
          title="Open in browser"
          aria-label="Open in browser"
        >
          <ExternalLink />
        </WebViewerToolbarButton>
      </div>
    </div>
  );
}
