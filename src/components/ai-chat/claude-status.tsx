import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Activity, AlertCircle, Loader2, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClaudeStatus } from "@/types/claude";
import { cn } from "@/utils/cn";
import Button from "../ui/button";

interface ClaudeStatusIndicatorProps {
  isActive: boolean;
}

export default function ClaudeStatusIndicator({ isActive }: ClaudeStatusIndicatorProps) {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch status periodically when active
  useEffect(() => {
    if (!isActive) return;

    const fetchStatus = async () => {
      try {
        const claudeStatus = await invoke<ClaudeStatus>("get_claude_status");
        setStatus(claudeStatus);
        setError(null);
      } catch (err) {
        console.error("Failed to get Claude status:", err);
        setError(`Failed to get Claude status: ${err}`);
      }
    };

    // Initial fetch
    fetchStatus();

    // Set up interval for periodic updates
    const interval = setInterval(fetchStatus, 2000);

    return () => clearInterval(interval);
  }, [isActive]);

  // Listen for interceptor logs (optional - enable for debugging)
  useEffect(() => {
    if (!isActive) return;

    const setupLogListeners = async () => {
      // Listen for interceptor logs
      const unlistenInterceptor = await listen<string>("interceptor-log", event => {
        console.log("[Interceptor]", event.payload);
      });

      // Listen for Claude stdout
      const unlistenClaudeOut = await listen<string>("claude-stdout", event => {
        console.log("[Claude]", event.payload);
      });

      // Listen for Claude stderr
      const unlistenClaudeErr = await listen<string>("claude-stderr", event => {
        // Claude stderr might contain stream-json error messages
        // Just log them without trying to parse as they're debugging info
        console.log("Claude stderr:", event.payload);
      });

      return () => {
        unlistenInterceptor();
        unlistenClaudeOut();
        unlistenClaudeErr();
      };
    };

    let cleanup: (() => void) | undefined;
    setupLogListeners().then(fn => {
      cleanup = fn;
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [isActive]);

  const handleStart = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const newStatus = await invoke<ClaudeStatus>("start_claude_code");
      setStatus(newStatus);
      if (!newStatus.running) {
        setError("Failed to start Claude Code");
      }
    } catch (err) {
      console.error("Failed to start Claude Code:", err);
      setError(`Failed to start Claude Code: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const newStatus = await invoke<ClaudeStatus>("stop_claude_code");
      setStatus(newStatus);
    } catch (err) {
      console.error("Failed to stop Claude Code:", err);
      setError(`Failed to stop Claude Code: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isActive) return null;

  const isRunning = status?.running || false;
  const isConnected = status?.connected || false;
  const isInterceptorRunning = status?.interceptor_running || false;

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded text-xs">
      {/* Status indicator */}
      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            isRunning && isConnected ? "bg-green-500" : isRunning ? "bg-yellow-500" : "bg-gray-500",
          )}
        />
        <span className="text-[--text-lighter]">
          {isRunning ? (isConnected ? "Connected" : "Starting...") : "Offline"}
        </span>
      </div>

      {/* Control button */}
      <Button
        size="xs"
        variant="ghost"
        onClick={isRunning ? handleStop : handleStart}
        disabled={isLoading}
        className="h-5 px-1.5"
        title={isRunning ? "Stop Claude Code" : "Start Claude Code"}
      >
        {isLoading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : isRunning ? (
          <Square size={12} />
        ) : (
          <Play size={12} />
        )}
      </Button>

      {/* Error indicator */}
      {error && (
        <div className="flex items-center gap-1 text-red-500">
          <AlertCircle size={12} />
          <span className="text-xs">{error}</span>
        </div>
      )}

      {/* Detailed status on hover */}
      {status && (
        <div className="group relative">
          <Activity size={12} className="text-[--text-lighter] cursor-help" />
          <div className="absolute bottom-full right-0 mb-1 hidden group-hover:block bg-[--bg-secondary] border border-[--border] rounded px-2 py-1 text-xs whitespace-nowrap z-50">
            <div>Claude: {isRunning ? "Running" : "Stopped"}</div>
            <div>Interceptor: {isInterceptorRunning ? "Running" : "Stopped"}</div>
            <div>WebSocket: {isConnected ? "Connected" : "Disconnected"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
