import { Channel } from "@tauri-apps/api/core";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { TerminalEvent, TerminalSize } from "../types/terminal.types";

type TerminalEventListener = (event: TerminalEvent) => void;

interface TerminalEventStream {
  listeners: Set<TerminalEventListener>;
  pending: TerminalEvent[];
}

const eventStreams = new Map<string, TerminalEventStream>();
export const TERMINAL_OUTPUT_HIGH_WATERMARK = 500_000;
export const TERMINAL_OUTPUT_LOW_WATERMARK = 100_000;

export interface PendingTerminalEventChannel {
  channel: Channel<TerminalEvent>;
  bind: (connectionId: string) => void;
}

export function createTerminalEventChannel(): PendingTerminalEventChannel {
  const stream: TerminalEventStream = {
    listeners: new Set(),
    pending: [],
  };
  let connectionId: string | null = null;

  const channel = new Channel<TerminalEvent>((event) => {
    if (!connectionId) {
      stream.pending.push(event);
      return;
    }

    dispatchTerminalEvent(stream, event);
  });

  return {
    channel,
    bind: (id) => {
      connectionId = id;
      eventStreams.set(id, stream);
      flushPendingEvents(stream);
    },
  };
}

export function subscribeToTerminalEvents(
  connectionId: string,
  listener: TerminalEventListener,
): () => void {
  const stream = eventStreams.get(connectionId);
  if (!stream) return () => {};

  stream.listeners.add(listener);
  flushPendingEvents(stream);

  return () => {
    stream.listeners.delete(listener);
  };
}

export function releaseTerminalEventChannel(connectionId: string): void {
  eventStreams.delete(connectionId);
}

function flushPendingEvents(stream: TerminalEventStream): void {
  if (stream.listeners.size === 0 || stream.pending.length === 0) return;

  const pending = stream.pending.splice(0);
  for (const event of pending) {
    dispatchTerminalEvent(stream, event);
  }
}

function dispatchTerminalEvent(stream: TerminalEventStream, event: TerminalEvent): void {
  if (stream.listeners.size === 0) {
    stream.pending.push(event);
    return;
  }

  for (const listener of stream.listeners) {
    listener(event);
  }
}

export function getTerminalSize(terminal: XtermTerminal): TerminalSize {
  const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
  const rect = (screen ?? terminal.element)?.getBoundingClientRect();

  return {
    rows: terminal.rows,
    cols: terminal.cols,
    pixelWidth: toPtyPixelSize(rect?.width ?? 0),
    pixelHeight: toPtyPixelSize(rect?.height ?? 0),
  };
}

export function terminalSizesEqual(left: TerminalSize | null, right: TerminalSize): boolean {
  return (
    left?.rows === right.rows &&
    left.cols === right.cols &&
    left.pixelWidth === right.pixelWidth &&
    left.pixelHeight === right.pixelHeight
  );
}

export function getTerminalOutputFlowAction(
  queuedBytes: number,
  paused: boolean,
): "pause" | "resume" | "none" {
  if (!paused && queuedBytes >= TERMINAL_OUTPUT_HIGH_WATERMARK) return "pause";
  if (paused && queuedBytes <= TERMINAL_OUTPUT_LOW_WATERMARK) return "resume";
  return "none";
}

function toPtyPixelSize(value: number): number {
  return Math.min(65535, Math.max(0, Math.round(value)));
}
