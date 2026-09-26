import { save } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { DropdownMenuItem } from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import {
  ArrowClockwiseIcon,
  ArrowsLeftRightIcon,
  BracketsCurlyIcon,
  ListIcon,
  SearchIcon,
} from "@/ui/icons";
import Input from "@/ui/input";
import { ResourceActionsMenu, ResourceSummary, ResourceWorkspace } from "@/ui/resource";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import { ToggleGroup } from "@/ui/toggle-group";
import { tryWriteClipboardText } from "@/utils/clipboard";
import { useAcpTraffic } from "../hooks/use-acp-traffic";
import {
  buildTrafficMessages,
  filterTrafficMessages,
  formatTrafficMessage,
  formatTrafficMessages,
  trafficSessionIds,
} from "../lib/acp-traffic-messages";
import type {
  AcpTrafficDirectionFilter,
  AcpTrafficMessage,
  AcpTrafficProcess,
} from "../types/acp-traffic.types";
import { AcpCapabilitiesPanel } from "./acp-capabilities-panel";
import { AcpTrafficLog } from "./acp-traffic-log";

type InspectorTab = "messages" | "capabilities";

const ALL_SESSIONS = "all";

const DIRECTION_OPTIONS: { value: AcpTrafficDirectionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "out", label: "Out" },
  { value: "in", label: "In" },
  { value: "stderr", label: "Stderr" },
];

function processLabel(process: AcpTrafficProcess): string {
  const workspace = process.workspacePath?.split(/[\\/]/).filter(Boolean).pop();
  return workspace ? `${process.agentName} in ${workspace}` : process.agentName;
}

function exportFileName(process: AcpTrafficProcess): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `acp-${process.agentId}-${stamp}.jsonl`;
}

async function copyText(text: string, success: string) {
  if (await tryWriteClipboardText(text)) toast.success(success);
  else toast.error("Couldn't copy to the clipboard");
}

export default function AcpInspectorView() {
  const traffic = useAcpTraffic();
  const { selectedProcess } = traffic;
  const [tab, setTab] = useState<InspectorTab>("messages");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<AcpTrafficDirectionFilter>("all");
  const [sessionId, setSessionId] = useState(ALL_SESSIONS);
  const [isRestarting, setIsRestarting] = useState(false);

  const messages = useMemo(() => buildTrafficMessages(traffic.entries), [traffic.entries]);
  const messagesByKey = useMemo(
    () => new Map(messages.map((message) => [message.key, message])),
    [messages],
  );
  const sessionIds = useMemo(() => trafficSessionIds(messages), [messages]);
  const visibleMessages = useMemo(
    () =>
      filterTrafficMessages(messages, {
        query,
        direction,
        sessionId: sessionId === ALL_SESSIONS ? null : sessionId,
      }),
    [direction, messages, query, sessionId],
  );

  const handleCopy = (message: AcpTrafficMessage) =>
    void copyText(formatTrafficMessage(message), "Message copied");

  const handleCopyAll = () =>
    void copyText(formatTrafficMessages(visibleMessages), "Messages copied");

  const handleClear = async () => {
    try {
      await traffic.clear();
    } catch (error) {
      toast.error(`Couldn't clear the log: ${String(error)}`);
    }
  };

  const handleExport = async () => {
    if (!selectedProcess) return;
    try {
      const path = await save({
        defaultPath: exportFileName(selectedProcess),
        filters: [
          { name: "JSON Lines", extensions: ["jsonl"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!path) return;
      await traffic.exportTo(path);
      toast.success("ACP traffic exported");
    } catch (error) {
      toast.error(`Couldn't export the log: ${String(error)}`);
    }
  };

  const handleRestart = async () => {
    if (!selectedProcess) return;
    setIsRestarting(true);
    try {
      await AcpStreamHandler.restartAgentProcess(
        selectedProcess.agentId,
        selectedProcess.workspacePath,
      );
    } catch (error) {
      toast.error(`Couldn't restart ${selectedProcess.agentName}: ${String(error)}`);
    } finally {
      setIsRestarting(false);
    }
  };

  const summary = (
    <ResourceSummary
      icon={<ArrowsLeftRightIcon />}
      title="ACP Inspector"
      badges={
        selectedProcess ? (
          <Badge tone={selectedProcess.running ? "success" : "neutral"}>
            {selectedProcess.running ? "Running" : "Stopped"}
          </Badge>
        ) : null
      }
      description={
        selectedProcess?.workspacePath ?? "JSON-RPC traffic between Athas and its ACP agents"
      }
      actions={
        <>
          {traffic.processes.length > 0 ? (
            <Select
              value={selectedProcess?.processKey ?? ""}
              options={traffic.processes.map((process) => ({
                value: process.processKey,
                label: processLabel(process),
              }))}
              onChange={traffic.selectProcess}
              aria-label="Agent process"
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleRestart()}
            disabled={!selectedProcess || isRestarting}
          >
            {isRestarting ? <Spinner label="Restarting" compact /> : <ArrowClockwiseIcon />}
            Restart agent
          </Button>
          <ResourceActionsMenu label="Inspector actions">
            <DropdownMenuItem disabled={visibleMessages.length === 0} onClick={handleCopyAll}>
              Copy all
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selectedProcess} onClick={() => void handleExport()}>
              Export...
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!selectedProcess || messages.length === 0}
              onClick={() => void handleClear()}
            >
              Clear
            </DropdownMenuItem>
          </ResourceActionsMenu>
        </>
      }
    />
  );

  const tabs = (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        active={tab === "messages"}
        aria-pressed={tab === "messages"}
        onClick={() => setTab("messages")}
      >
        <ListIcon />
        Messages
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        active={tab === "capabilities"}
        aria-pressed={tab === "capabilities"}
        onClick={() => setTab("capabilities")}
      >
        <BracketsCurlyIcon />
        Capabilities
      </Button>
      {tab === "messages" ? (
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex w-52 min-w-0">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by method or id"
              aria-label="Filter messages"
              leftIcon={SearchIcon}
            />
          </span>
          <ToggleGroup
            options={DIRECTION_OPTIONS}
            value={direction}
            onValueChange={setDirection}
            ariaLabel="Direction"
            wrap={false}
          />
          {sessionIds.length > 0 ? (
            <Select
              value={sessionId}
              options={[
                { value: ALL_SESSIONS, label: "All sessions" },
                ...sessionIds.map((id) => ({ value: id, label: id })),
              ]}
              onChange={setSessionId}
              aria-label="Session"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (traffic.processes.length === 0) {
    return (
      <ResourceWorkspace summary={summary}>
        <EmptyState
          className="min-h-40"
          title="No agent traffic yet"
          message={
            traffic.error ?? "Start a chat with an ACP agent and its messages will show up here."
          }
        />
      </ResourceWorkspace>
    );
  }

  return (
    <ResourceWorkspace summary={summary} tabs={tabs}>
      {tab === "capabilities" ? (
        <AcpCapabilitiesPanel initialize={traffic.initialize} />
      ) : (
        <AcpTrafficLog
          messages={visibleMessages}
          messagesByKey={messagesByKey}
          emptyMessage={
            traffic.isLoading
              ? "Loading traffic..."
              : messages.length === 0
                ? "No messages recorded for this process yet."
                : "No messages match the filter."
          }
          onCopy={handleCopy}
        />
      )}
    </ResourceWorkspace>
  );
}
