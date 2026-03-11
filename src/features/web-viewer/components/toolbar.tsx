import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Code2,
  Copy,
  Smartphone,
  ExternalLink,
  Home,
  Minus,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useState } from "react";
import Input from "@/ui/input";
import { useWebViewerStore } from "../stores/web-viewer-store";
import { getSecurityInfo } from "../utils/url";
import { HistoryPanel } from "./history-panel";

interface ToolbarProps {
  currentUrl: string;
  inputUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomLevel: number;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  onInputUrlChange: (url: string) => void;
  onUrlSubmit: (e: React.FormEvent) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onRefresh: () => void;
  onStopLoading: () => void;
  onHome: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onCopyUrl: () => void;
  onOpenDevTools: () => void;
  onOpenExternal: () => void;
  onNavigate: (url: string) => void;
}

export function Toolbar({
  currentUrl,
  inputUrl,
  isLoading,
  canGoBack,
  canGoForward,
  zoomLevel,
  urlInputRef,
  onInputUrlChange,
  onUrlSubmit,
  onGoBack,
  onGoForward,
  onRefresh,
  onStopLoading,
  onHome,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onCopyUrl,
  onOpenDevTools,
  onOpenExternal,
  onNavigate,
}: ToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const responsiveMode = useWebViewerStore.use.responsiveMode();
  const { setResponsiveMode } = useWebViewerStore.use.actions();

  const { icon: SecurityIcon, color: securityColor, tooltip: securityTooltip } = getSecurityInfo(currentUrl);

  const handleCopyUrl = () => {
    onCopyUrl();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-border border-b bg-secondary-bg px-2">
      <div className="flex items-center gap-0.5">
        <ToolbarButton
          onClick={onGoBack}
          disabled={!canGoBack}
          title="Go back"
          aria-label="Go back"
        >
          <ArrowLeft size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onGoForward}
          disabled={!canGoForward}
          title="Go forward"
          aria-label="Go forward"
        >
          <ArrowRight size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={isLoading ? onStopLoading : onRefresh}
          title={isLoading ? "Stop loading" : "Refresh"}
          aria-label={isLoading ? "Stop loading" : "Refresh"}
        >
          {isLoading ? <X size={15} /> : <RefreshCw size={15} />}
        </ToolbarButton>
        <ToolbarButton onClick={onHome} title="Go to home" aria-label="Go to home">
          <Home size={15} />
        </ToolbarButton>
      </div>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <form onSubmit={onUrlSubmit} className="flex flex-1 items-center">
        <div className="relative flex flex-1 items-center">
          <div
            className={`absolute left-2.5 flex items-center ${securityColor}`}
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
            onClick={handleCopyUrl}
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
        <ToolbarButton
          onClick={onZoomOut}
          disabled={zoomLevel <= 0.25}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={15} />
        </ToolbarButton>
        <button
          type="button"
          onClick={onResetZoom}
          className="flex h-7 min-w-[44px] items-center justify-center rounded px-1.5 text-[11px] text-text-light transition-colors hover:bg-hover"
          title="Reset zoom (click to reset)"
          aria-label="Reset zoom"
        >
          {Math.round(zoomLevel * 100)}%
        </button>
        <ToolbarButton
          onClick={onZoomIn}
          disabled={zoomLevel >= 3}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={15} />
        </ToolbarButton>
      </div>

      <div className="mx-1.5 h-5 w-px bg-border" />

      <div className="relative flex items-center gap-0.5">
        <ToolbarButton
          onClick={() => setHistoryOpen(!historyOpen)}
          title="Browsing history"
          aria-label="Browsing history"
        >
          <Clock size={15} />
        </ToolbarButton>
        <HistoryPanel
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onNavigate={onNavigate}
        />
        <ToolbarButton
          onClick={() => setResponsiveMode(!responsiveMode)}
          title={responsiveMode ? "Exit device preview" : "Device preview"}
          aria-label={responsiveMode ? "Exit device preview" : "Device preview"}
        >
          <Smartphone size={15} className={responsiveMode ? "text-accent" : undefined} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onOpenDevTools}
          title="Open Developer Tools"
          aria-label="Open Developer Tools"
        >
          <Code2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onOpenExternal}
          title="Open in browser"
          aria-label="Open in browser"
        >
          <ExternalLink size={15} />
        </ToolbarButton>
      </div>
    </div>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  "aria-label": string;
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
  "aria-label": ariaLabel,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-text-light transition-colors hover:bg-hover hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-light"
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
