import { normalizeTerminalTitle } from "./terminal-title";

const ESC = "\u001b";
const BEL = "\u0007";
const C1_OSC = "\u009d";
const C1_ST = "\u009c";
const MAX_OSC_PAYLOAD_LENGTH = 8192;

type ParserState = "ground" | "escape" | "command" | "payload" | "payload-escape";

export interface TerminalOscUpdates {
  currentDirectory?: string;
  title?: string;
}

export class TerminalOscStream {
  private state: ParserState = "ground";
  private command = "";
  private payload = "";

  reset() {
    this.state = "ground";
    this.command = "";
    this.payload = "";
  }

  feed(data: string): TerminalOscUpdates {
    const updates: TerminalOscUpdates = {};

    for (const character of data) {
      switch (this.state) {
        case "ground":
          if (character === ESC) {
            this.state = "escape";
          } else if (character === C1_OSC) {
            this.startOsc();
          }
          break;
        case "escape":
          if (character === "]") {
            this.startOsc();
          } else if (character !== ESC) {
            this.state = "ground";
          }
          break;
        case "command":
          if (character >= "0" && character <= "9" && this.command.length < 4) {
            this.command += character;
          } else if (character === ";" && this.command) {
            this.state = "payload";
          } else if (character === ESC) {
            this.state = "escape";
          } else if (character === C1_OSC) {
            this.startOsc();
          } else {
            this.reset();
          }
          break;
        case "payload":
          if (character === BEL || character === C1_ST) {
            this.completeOsc(updates);
          } else if (character === ESC) {
            this.state = "payload-escape";
          } else if (character === C1_OSC) {
            this.startOsc();
          } else if (this.payload.length < MAX_OSC_PAYLOAD_LENGTH) {
            this.payload += character;
          } else {
            this.reset();
          }
          break;
        case "payload-escape":
          if (character === "\\") {
            this.completeOsc(updates);
          } else if (character === "]") {
            this.startOsc();
          } else if (character !== ESC) {
            this.reset();
          }
          break;
      }
    }

    return updates;
  }

  private startOsc() {
    this.state = "command";
    this.command = "";
    this.payload = "";
  }

  private completeOsc(updates: TerminalOscUpdates) {
    const command = Number(this.command);

    if (command === 0 || command === 2) {
      updates.title = normalizeTerminalTitle(this.payload) ?? "";
    } else if (command === 7) {
      const currentDirectory = parseOsc7Directory(this.payload);
      if (currentDirectory) updates.currentDirectory = currentDirectory;
    }

    this.reset();
  }
}

function parseOsc7Directory(payload: string): string | null {
  if (!payload.startsWith("file://")) return null;

  const pathStart = payload.indexOf("/", "file://".length);
  if (pathStart === -1) return null;

  const path = payload.slice(pathStart);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
