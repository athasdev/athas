import type { GitDiffLine, GitDiff_Serialize } from "@/bindings/commands";

/**
 * The client side of the cloud workspace protocol served by the athas-cloud Worker
 * (www/cloud/src/workspace-protocol.ts): the session the website's token endpoint hands out, the
 * events the workspace socket pushes, and the decoders for its binary frames and git patches.
 */

/** What POST /api/cloud-workspaces/:id/token on athas.dev returns for a running workspace. */
export interface WorkspaceSession {
  workspaceId: string;
  /** The Worker's https URL; the socket is `wss://…/workspaces/:id/socket`. */
  endpoint: string;
  token: string;
  expiresAt: string;
  repo: string;
  branch: string;
}

export interface WorkspaceInfo {
  id: string;
  repo: string;
  branch: string;
  /** The repository's directory in the sandbox; the workbench opens it under the same path. */
  root: string;
  terminals: string[];
  stopsAt: number;
}

export interface WorkspaceFileChange {
  path: string;
  kind: "created" | "modified" | "removed";
  isDir: boolean;
}

export type WorkspaceEvent =
  | { type: "fs.changes"; changes: WorkspaceFileChange[]; gitChanged: boolean; rescan: boolean }
  | { type: "terminal.exit"; id: string; exitCode: number | null }
  | { type: "stopped"; reason: string; error?: string }
  /** The socket authenticated again after a reconnect. */
  | { type: "reconnected"; workspace: WorkspaceInfo };

/** Close codes the Worker uses on the workspace socket. */
export const SOCKET_UNAUTHORIZED = 4001;
export const SOCKET_STOPPED = 4003;
export const SOCKET_NOT_READY = 4004;

export function isWorkspaceSession(value: unknown): value is WorkspaceSession {
  const session = value as Partial<WorkspaceSession> | null;
  if (!session || typeof session !== "object") return false;
  if (
    typeof session.workspaceId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(session.workspaceId) ||
    typeof session.token !== "string" ||
    !session.token ||
    typeof session.expiresAt !== "string" ||
    typeof session.repo !== "string" ||
    typeof session.branch !== "string" ||
    typeof session.endpoint !== "string"
  )
    return false;
  try {
    const url = new URL(session.endpoint);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && local);
  } catch {
    return false;
  }
}

export function workspaceSocketUrl(session: Pick<WorkspaceSession, "endpoint" | "workspaceId">) {
  const url = new URL(session.endpoint);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/workspaces/${session.workspaceId}/socket`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

const decoder = new TextDecoder();

/** Terminal output frames: byte 1, the id's length, the id, then the output bytes. */
export function decodeTerminalFrame(frame: Uint8Array) {
  if (frame.length < 2 || frame[0] !== 1) return null;
  const length = frame[1];
  if (frame.length < 2 + length) return null;
  return { id: decoder.decode(frame.subarray(2, 2 + length)), data: frame.subarray(2 + length) };
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** One file's part of a unified patch, as `git diff` prints it. */
export interface PatchFile {
  path: string;
  oldPath: string | null;
  newPath: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  lines: GitDiffLine[];
  additions: number;
  deletions: number;
  raw: string;
}

function patchPath(value: string) {
  if (value === "/dev/null") return null;
  return value.replace(/^"|"$/g, "").replace(/^[ab]\//, "");
}

/** Splits `git diff` output into files with numbered lines. */
export function parseUnifiedPatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      current = {
        path: match?.[2] ?? "",
        oldPath: match?.[1] ?? null,
        newPath: match?.[2] ?? null,
        isNew: false,
        isDeleted: false,
        isBinary: false,
        lines: [],
        additions: 0,
        deletions: 0,
        raw: "",
      };
      files.push(current);
    }
    if (!current) continue;
    current.raw += `${line}\n`;
    if (line.startsWith("new file mode")) current.isNew = true;
    else if (line.startsWith("deleted file mode")) current.isDeleted = true;
    else if (line.startsWith("Binary files ")) current.isBinary = true;
    else if (line.startsWith("--- ")) {
      current.oldPath = patchPath(line.slice(4));
      if (current.oldPath === null) current.isNew = true;
    } else if (line.startsWith("+++ ")) {
      current.newPath = patchPath(line.slice(4));
      if (current.newPath === null) current.isDeleted = true;
      else current.path = current.newPath;
    } else if (line.startsWith("@@")) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLine = Number(hunk?.[1] ?? 0);
      newLine = Number(hunk?.[2] ?? 0);
      current.lines.push({
        line_type: "header",
        content: line,
        old_line_number: null,
        new_line_number: null,
      });
    } else if (current.lines.length) {
      if (line.startsWith("+")) {
        current.lines.push({
          line_type: "added",
          content: line.slice(1),
          old_line_number: null,
          new_line_number: newLine++,
        });
        current.additions++;
      } else if (line.startsWith("-")) {
        current.lines.push({
          line_type: "removed",
          content: line.slice(1),
          old_line_number: oldLine++,
          new_line_number: null,
        });
        current.deletions++;
      } else if (line.startsWith(" ")) {
        current.lines.push({
          line_type: "context",
          content: line.slice(1),
          old_line_number: oldLine++,
          new_line_number: newLine++,
        });
      }
    }
  }
  return files;
}

export function patchToGitDiff(file: PatchFile | undefined, path: string): GitDiff_Serialize {
  return {
    file_path: file?.path ?? path,
    old_path: file ? file.oldPath : path,
    new_path: file ? file.newPath : path,
    is_new: file?.isNew ?? false,
    is_deleted: file?.isDeleted ?? false,
    is_renamed: Boolean(file && file.oldPath && file.newPath && file.oldPath !== file.newPath),
    is_binary: file?.isBinary ?? false,
    is_image: false,
    old_blob_base64: null,
    new_blob_base64: null,
    lines: file?.lines ?? [],
    raw_patch: file?.raw ?? null,
    additions: file?.additions ?? 0,
    deletions: file?.deletions ?? 0,
  };
}
