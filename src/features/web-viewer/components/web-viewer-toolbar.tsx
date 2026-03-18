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
          <ArrowLeft size={15} />
        </WebViewerToolbarButton>
        <WebViewerToolbarButton
          onClick={onGoForward}
          disabled={!canGoForward}
          title="Go forward"
          aria-label="Go forward"
        >
          <ArrowRight size={15} />
        </WebViewerToolbarButton>
        <WebViewerToolbarButton
          onClick={isLoading ? onStopLoading : onRefresh}
          title={isLoading ? "Stop loading" : "Refresh"}
          aria-label={isLoading ? "Stop loading" : "Refresh"}
        >
          {isLoading ? <X size={15} /> : <RefreshCw size={15} />}
        </WebViewerToolbarButton>
        <WebViewerToolbarButton onClick={onHome} title="Go to home" aria-label="Go to home">
          <Home size={15} />
        </WebViewerToolbarButton>
      </div>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <form onSubmit={onUrlSubmit} className="flex flex-1 items-center">
        <div className="relative flex flex-1 items-center">
          <div
            className={`absolute left-2.5 flex items-center ${securityToneClass}`}
            title={securityTooltip}
          >
            <SecurityIcon size={14} />
          </div>
          <Input
            ref={urlInputRef}
            type="text"
            value={inputUrl}
            onChange={(e) => onInputUrlChange(e.target.value)}
            placeholder="Enter URL..."
            className="h-7 w-full rounded-md border-border bg-primary-bg pr-8 pl-8 text-[13px] focus:border-accent focus:ring-accent/30"
          />
          <button
            type="button"
            onClick={onCopyUrl}
            className="absolute right-2 flex items-center text-text-lighter transition-colors hover:text-text"
            title="Copy URL"
            aria-label="Copy URL"
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </button>
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
          <Minus size={15} />
        </WebViewerToolbarButton>
        <button
          type="button"
          onClick={onResetZoom}
          className="flex h-7 min-w-[44px] items-center justify-center rounded px-1.5 text-[11px] text-text-light transition-colors hover:bg-hover"
          title="Reset zoom (click to reset)"
          aria-label="Reset zoom"
        >
          {Math.round(zoomLevel * 100)}%
        </button>
        <WebViewerToolbarButton
          onClick={onZoomIn}
          disabled={zoomLevel >= 3}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={15} />
        </WebViewerToolbarButton>
      </div>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <div className="flex items-center gap-0.5">
        <WebViewerToolbarButton
          onClick={onOpenDevTools}
          title="Open Developer Tools"
          aria-label="Open Developer Tools"
        >
          <Code2 size={15} />
        </WebViewerToolbarButton>
        <WebViewerToolbarButton
          onClick={onOpenExternal}
          title="Open in browser"
          aria-label="Open in browser"
        >
          <ExternalLink size={15} />
        </WebViewerToolbarButton>
      </div>
    </div>
  );
}
