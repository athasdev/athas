import type { Channel } from "@tauri-apps/api/core";
import {
  commands,
  type RemoteTerminalTarget,
  type TerminalConfig_Deserialize,
  type TerminalEvent,
  type TerminalInput,
  type TerminalSize,
} from "@/bindings/commands";

type TerminalEventChannel = Channel<ArrayBuffer | TerminalEvent>;

export const spawnLocalTerminal = (
  config: TerminalConfig_Deserialize,
  onEvent: TerminalEventChannel,
  windowLabel: string,
  frontendSessionId: string,
) => commands.createTerminal(config, onEvent, windowLabel, frontendSessionId);

export const spawnRemoteTerminal = (
  target: RemoteTerminalTarget,
  size: TerminalSize,
  onEvent: TerminalEventChannel,
  windowLabel: string,
  frontendSessionId: string,
) => commands.createRemoteTerminal(target, size, onEvent, windowLabel, frontendSessionId);

export const writeLocalTerminalInput = (connectionId: string, input: TerminalInput) =>
  commands.terminalWrite(connectionId, input);

export const writeRemoteTerminalInput = (connectionId: string, input: TerminalInput) =>
  commands.remoteTerminalWrite(connectionId, input);

export const resizeLocalTerminal = (connectionId: string, size: TerminalSize) =>
  commands.terminalResize(connectionId, size);

export const setLocalTerminalOutputPaused = (connectionId: string, paused: boolean) =>
  commands.terminalSetPaused(connectionId, paused);
