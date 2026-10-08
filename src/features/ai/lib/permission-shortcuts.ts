import type { AcpPermissionOption } from "@/features/ai/types/acp.types";

type PermissionShortcut = "enter" | "mod+enter" | "escape";

const SHORTCUT_KINDS: Record<PermissionShortcut, AcpPermissionOption["kind"]> = {
  enter: "allow_once",
  "mod+enter": "allow_always",
  escape: "reject_once",
};

/** Enter allows once, Cmd/Ctrl+Enter always allows when the agent offers it, Esc denies. */
export function getPermissionShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): PermissionShortcut | null {
  if (event.shiftKey || event.altKey) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === "Enter") return mod ? "mod+enter" : "enter";
  if (event.key === "Escape" && !mod) return "escape";
  return null;
}

export function findPermissionOptionForShortcut(
  options: AcpPermissionOption[],
  shortcut: PermissionShortcut,
): AcpPermissionOption | null {
  return options.find((option) => option.kind === SHORTCUT_KINDS[shortcut]) ?? null;
}

export function getPermissionOptionShortcut(
  option: AcpPermissionOption,
): PermissionShortcut | undefined {
  return (Object.keys(SHORTCUT_KINDS) as PermissionShortcut[]).find(
    (shortcut) => SHORTCUT_KINDS[shortcut] === option.kind,
  );
}
