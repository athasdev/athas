import { listen } from "@tauri-apps/api/event";
import { Activity, ChevronDown, ChevronRight, Clock, Send, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { InterceptedRequest, InterceptorMessage } from "@/types/claude";
import { cn } from "@/utils/cn";

interface InterceptorDisplayProps {
  isActive: boolean;
}

export default function InterceptorDisplay({ isActive }: InterceptorDisplayProps) {
  const [requests, setRequests] = useState<InterceptedRequest[]>([]);
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isActive) return;

    const setupListener = async () => {
      const unlisten = await listen<InterceptorMessage>("claude-message", event => {
        const message = event.payload;

        if (message.type === "request" && message.data) {
          setRequests(prev => [...prev, message.data!]);
        } else if (message.type === "response" && message.data) {
          const responseData = message.data;
          setRequests(prev => prev.map(req => (req.id === responseData.id ? responseData : req)));
        }
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => {
      cleanup = fn;
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [isActive]);

  const toggleExpanded = (id: string) => {
    setExpandedRequests(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!isActive || requests.length === 0) return null;

  return (
    <div className="border-t border-[--border] bg-[--bg-secondary] p-2 max-h-48 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2 text-xs text-[--text-lighter]">
        <Activity size={12} />
        <span>Intercepted API Calls</span>
      </div>

      <div className="space-y-1">
        {requests.map(request => {
          const isExpanded = expandedRequests.has(request.id);
          const isComplete = !!request.parsed_response;

          return (
            <div
              key={request.id}
              className="text-xs border border-[--border] rounded p-2 bg-[--bg-primary]"
            >
              <button
                onClick={() => toggleExpanded(request.id)}
                className="w-full flex items-center justify-between hover:opacity-80"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Send size={12} className="text-blue-500" />
                  <span className="font-mono">{request.parsed_request.model}</span>
                  {request.parsed_request.stream && (
                    <span title="Streaming">
                      <Zap size={12} className="text-yellow-500" />
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[--text-lighter]">
                  {request.duration_ms && (
                    <>
                      <Clock size={12} />
                      <span>{request.duration_ms}ms</span>
                    </>
                  )}
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px]",
                      isComplete
                        ? "bg-green-500/20 text-green-500"
                        : "bg-yellow-500/20 text-yellow-500",
                    )}
                  >
                    {isComplete ? "Complete" : "Pending"}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-2 space-y-2 text-[11px]">
                  {/* Request Details */}
                  <div className="p-2 bg-[--bg-secondary] rounded">
                    <div className="font-semibold mb-1">Request</div>
                    <div className="space-y-1">
                      <div>Messages: {request.parsed_request.messages.length}</div>
                      {request.parsed_request.temperature !== undefined && (
                        <div>Temperature: {request.parsed_request.temperature}</div>
                      )}
                      {request.parsed_request.max_tokens && (
                        <div>Max Tokens: {request.parsed_request.max_tokens}</div>
                      )}
                    </div>
                  </div>

                  {/* Response Details */}
                  {request.parsed_response && (
                    <div className="p-2 bg-[--bg-secondary] rounded">
                      <div className="font-semibold mb-1">Response</div>
                      <div className="space-y-1">
                        {request.parsed_response.usage && (
                          <div>
                            Tokens: {request.parsed_response.usage.input_tokens} in /{" "}
                            {request.parsed_response.usage.output_tokens} out
                          </div>
                        )}
                        {request.parsed_response.stop_reason && (
                          <div>Stop Reason: {request.parsed_response.stop_reason}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {request.error && (
                    <div className="p-2 bg-red-500/10 border border-red-500/20 rounded">
                      <div className="font-semibold text-red-500 mb-1">Error</div>
                      <div className="text-red-400">{request.error}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
