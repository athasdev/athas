import type { Keybinding } from "../types/keymaps.types";

export type KeybindingImportPlatform = "macos" | "windows" | "linux";

export type KeybindingImportIssueReason =
  | "invalid-entry"
  | "unknown-command"
  | "empty-command"
  | "unsupported-key"
  | "unsupported-when"
  | "unsupported-arguments";

export interface KeybindingImportIssue {
  index: number;
  reason: KeybindingImportIssueReason;
  command?: string;
}

interface VsCodeImportOptions {
  commandIds: Set<string>;
  platform: KeybindingImportPlatform;
}

interface VsCodeImportResult {
  format: "athas" | "vscode";
  keybindings: Keybinding[];
  issues: KeybindingImportIssue[];
}

const VSCODE_COMMANDS: Record<string, string> = {
  "workbench.action.files.newUntitledFile": "file.new",
  "workbench.action.newWindow": "workbench.newWindow",
  "workbench.action.files.save": "file.save",
  "workbench.action.files.saveAs": "file.saveAs",
  "workbench.action.files.saveAll": "file.saveAll",
  saveAll: "file.saveAll",
  "workbench.action.files.revert": "file.revert",
  "workbench.action.closeActiveEditor": "file.close",
  "workbench.action.closeWindow": "workbench.closeWindow",
  "workbench.action.closeAllEditors": "file.closeAll",
  "workbench.action.closeOtherEditors": "file.closeOthers",
  "workbench.action.closeUnmodifiedEditors": "file.closeSaved",
  "workbench.action.closeEditorsToTheLeft": "file.closeTabsToLeft",
  "workbench.action.closeEditorsToTheRight": "file.closeTabsToRight",
  "workbench.action.reopenClosedEditor": "file.reopenClosed",
  "workbench.action.files.openFolder": "file.open",
  "workbench.action.quickOpen": "file.quickOpen",
  "editor.action.selectAll": "editor.selectAll",
  selectAll: "editor.selectAll",
  undo: "editor.undo",
  redo: "editor.redo",
  "editor.action.clipboardCopyAction": "editor.copy",
  "editor.action.clipboardCutAction": "editor.cut",
  "editor.action.clipboardPasteAction": "editor.paste",
  "editor.action.addSelectionToNextFindMatch": "editor.selectNextOccurrence",
  "editor.action.addSelectionToPreviousFindMatch": "editor.selectPreviousOccurrence",
  "editor.action.selectHighlights": "editor.selectAllOccurrences",
  "editor.action.duplicateSelection": "editor.duplicateLine",
  "editor.action.deleteLines": "editor.deleteLine",
  "editor.action.commentLine": "editor.toggleComment",
  "editor.foldAll": "editor.foldAll",
  "editor.unfoldAll": "editor.unfoldAll",
  "editor.action.moveLinesUpAction": "editor.moveLineUp",
  "editor.action.moveLinesDownAction": "editor.moveLineDown",
  "editor.action.copyLinesUpAction": "editor.copyLineUp",
  "editor.action.copyLinesDownAction": "editor.copyLineDown",
  "editor.action.insertCursorAbove": "editor.insertCursorAbove",
  "editor.action.insertCursorBelow": "editor.insertCursorBelow",
  "editor.action.insertCursorAtEndOfEachLineSelected": "editor.insertCursorsAtLineEnds",
  removeSecondaryCursors: "editor.removeSecondaryCursors",
  "editor.action.formatDocument": "editor.formatDocument",
  "editor.action.formatSelection": "editor.formatSelection",
  "editor.action.triggerSuggest": "editor.triggerSuggest",
  "editor.action.triggerParameterHints": "editor.triggerParameterHints",
  "editor.action.showHover": "editor.showHover",
  "editor.action.quickFix": "editor.quickFix",
  "editor.action.inlineEdit.trigger": "editor.inlineEdit",
  "workbench.action.toggleActivityBarVisibility": "workbench.toggleActivitySidebar",
  "workbench.action.toggleSidebarVisibility": "workbench.toggleSidebar",
  "workbench.action.terminal.toggleTerminal": "workbench.toggleTerminal",
  "workbench.actions.view.problems": "workbench.toggleDiagnostics",
  "workbench.action.showCommands": "workbench.commandPalette",
  "notifications.showList": "workbench.showNotifications",
  "actions.find": "workbench.showFind",
  "editor.action.startFindReplaceAction": "workbench.showFindReplace",
  "workbench.action.findInFiles": "workbench.showGlobalSearch",
  "workbench.action.replaceInFiles": "workbench.showProjectSearch",
  "workbench.view.explorer": "workbench.showFileExplorer",
  "workbench.view.scm": "workbench.showSourceControl",
  "workbench.view.debug": "workbench.showDebugger",
  "workbench.action.selectTheme": "workbench.showThemeSelector",
  "editor.action.toggleMinimap": "workbench.toggleMinimap",
  "editor.action.toggleWordWrap": "editor.toggleWordWrap",
  "editor.action.toggleRenderWhitespace": "editor.toggleRenderWhitespace",
  "workbench.action.zoomIn": "workbench.zoomIn",
  "workbench.action.zoomOut": "workbench.zoomOut",
  "workbench.action.zoomReset": "workbench.zoomReset",
  "workbench.action.openGlobalKeybindings": "workbench.openKeyboardShortcuts",
  "workbench.action.gotoSymbol": "editor.showOutline",
  "workbench.action.nextEditor": "workbench.nextTab",
  "workbench.action.nextEditorInGroup": "workbench.nextTab",
  "workbench.action.previousEditor": "workbench.previousTab",
  "workbench.action.previousEditorInGroup": "workbench.previousTab",
  "editor.action.revealDefinition": "editor.goToDefinition",
  "editor.action.goToImplementation": "editor.goToImplementation",
  "editor.action.goToTypeDefinition": "editor.goToTypeDefinition",
  "editor.action.referenceSearch.trigger": "editor.goToReferences",
  "editor.action.findReferences": "editor.goToReferences",
  "editor.action.jumpToBracket": "editor.goToBracket",
  "editor.action.selectToBracket": "editor.selectToBracket",
  "editor.action.smartSelect.expand": "editor.expandSelection",
  "editor.action.smartSelect.shrink": "editor.shrinkSelection",
  "editor.action.rename": "editor.renameSymbol",
  "workbench.action.navigateBack": "navigation.goBack",
  "workbench.action.navigateForward": "navigation.goForward",
  "workbench.action.toggleZenMode": "workbench.toggleActivePaneFullscreen",
  "workbench.action.splitEditorRight": "workbench.splitEditorRight",
  "workbench.action.splitEditorDown": "workbench.splitEditorDown",
  "workbench.action.closeEditorsAndGroup": "workbench.closeEditorGroup",
  "workbench.action.closeEditorsInOtherGroups": "workbench.closeOtherEditorGroups",
  "workbench.action.moveEditorToNextGroup": "workbench.moveEditorToNextGroup",
  "workbench.action.moveEditorToPreviousGroup": "workbench.moveEditorToPreviousGroup",
  "workbench.action.evenEditorWidths": "workbench.resetEditorGroupSizes",
  "workbench.action.terminal.new": "terminal.new",
  "workbench.action.terminal.kill": "terminal.close",
  "workbench.action.terminal.focusFindWidget": "terminal.find",
  "workbench.action.terminal.split": "terminal.split",
  "workbench.action.debug.start": "debug.start",
  "workbench.action.debug.stop": "debug.stop",
  "editor.debug.action.toggleBreakpoint": "debug.toggleBreakpoint",
  "workbench.action.openSettings": "workbench.openSettings",
  "workbench.action.toggleFullScreen": "window.toggleFullscreen",
  "workbench.action.quit": "window.quit",
  "workbench.action.toggleMenuBar": "window.toggleMenuBar",
};

for (let level = 1; level <= 7; level++) {
  VSCODE_COMMANDS[`editor.foldLevel${level}`] = `editor.foldLevel${level}`;
}

for (let index = 1; index <= 9; index++) {
  VSCODE_COMMANDS[`workbench.action.openEditorAtIndex${index}`] = `workbench.switchToTab${index}`;
}

const ATHAS_BUILT_IN_COMMAND_IDS = new Set(Object.values(VSCODE_COMMANDS));

const CONTEXT_ALIASES: Record<string, string> = {
  editorTextFocus: "editorFocus",
  editorFocus: "editorFocus",
  terminalFocus: "terminalFocus",
  editorHasSelection: "hasSelection",
  sideBarFocus: "sidebarFocus",
  findWidgetVisible: "findWidgetVisible",
};

const SCAN_CODE_KEYS: Record<string, string> = {
  backquote: "`",
  minus: "-",
  equal: "=",
  bracketleft: "[",
  bracketright: "]",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  comma: ",",
  period: ".",
  slash: "/",
  arrowleft: "left",
  arrowup: "up",
  arrowright: "right",
  arrowdown: "down",
  pageup: "pageup",
  pagedown: "pagedown",
  pause: "pause",
};

const NAMED_KEYS = new Set([
  "left",
  "up",
  "right",
  "down",
  "pageup",
  "pagedown",
  "end",
  "home",
  "tab",
  "enter",
  "escape",
  "space",
  "backspace",
  "delete",
  "pause",
  "pausebreak",
  "capslock",
  "insert",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPlatformKey(
  value: Record<string, unknown>,
  platform: KeybindingImportPlatform,
): string | null {
  const platformKey = platform === "macos" ? "mac" : platform === "windows" ? "win" : "linux";
  const selected = value[platformKey] ?? value.key;
  return typeof selected === "string" ? selected : null;
}

function normalizeScanCode(value: string): string | null {
  const scanCode = value.slice(1, -1).toLowerCase();

  if (/^key[a-z]$/.test(scanCode)) return scanCode.slice(3);
  if (/^digit[0-9]$/.test(scanCode)) return scanCode.slice(5);
  if (/^f(?:[1-9]|1[0-9])$/.test(scanCode)) return scanCode;

  return SCAN_CODE_KEYS[scanCode] ?? (NAMED_KEYS.has(scanCode) ? scanCode : null);
}

function normalizeVsCodeCombination(
  value: string,
  platform: KeybindingImportPlatform,
): string | null {
  const parts = value
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const modifiers: string[] = [];
  let key: string | null = null;

  for (const part of parts) {
    if (part === "ctrl" || part === "shift" || part === "alt" || part === "cmd") {
      if (!modifiers.includes(part)) modifiers.push(part);
      continue;
    }

    if (part === "win" || part === "meta") {
      if (platform !== "macos") return null;
      if (!modifiers.includes("cmd")) modifiers.push("cmd");
      continue;
    }

    if (key !== null) return null;

    if (part.startsWith("[") && part.endsWith("]")) {
      key = normalizeScanCode(part);
      continue;
    }

    if (
      /^[a-z0-9]$/.test(part) ||
      /^f(?:[1-9]|1[0-9])$/.test(part) ||
      NAMED_KEYS.has(part) ||
      /^[`\-=[\]\\;',./]$/.test(part)
    ) {
      key = part === "pausebreak" ? "pause" : part;
      continue;
    }

    return null;
  }

  if (!key) return null;
  return [...modifiers, key].join("+");
}

function normalizeVsCodeKey(value: string, platform: KeybindingImportPlatform): string | null {
  const chords = value.trim().split(/\s+/).filter(Boolean);

  if (chords.length === 0) return null;

  const normalized = chords.map((chord) => normalizeVsCodeCombination(chord, platform));
  return normalized.every((chord): chord is string => chord !== null) ? normalized.join(" ") : null;
}

function translateWhenClause(
  value: unknown,
  platform: KeybindingImportPlatform,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/==|!=|=~|\b(?:not\s+in|in)\b|[<>]/.test(trimmed)) return null;

  const platformValues: Record<string, string> = {
    isMac: String(platform === "macos"),
    isWindows: String(platform === "windows"),
    isLinux: String(platform === "linux"),
  };

  const translated = trimmed
    .replace(/!\s*editorReadonly\b/g, "true")
    .replace(/[A-Za-z_][A-Za-z0-9_.]*/g, (identifier) => {
      return CONTEXT_ALIASES[identifier] ?? platformValues[identifier] ?? identifier;
    })
    .replace(/\btrue\s*&&\s*/g, "")
    .replace(/\s*&&\s*true\b/g, "")
    .replace(/\bfalse\s*\|\|\s*/g, "")
    .replace(/\s*\|\|\s*false\b/g, "")
    .trim();
  const identifiers = translated.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? [];
  const supportedIdentifiers = new Set([...Object.values(CONTEXT_ALIASES), "true", "false"]);

  if (identifiers.some((identifier) => !supportedIdentifiers.has(identifier))) return null;
  if (/[^A-Za-z0-9_.!&|()\s]/.test(translated)) return null;

  return translated;
}

function translateCommand(command: string, commandIds: Set<string>): string | null {
  if (commandIds.has(command)) return command;
  const translated = VSCODE_COMMANDS[command];
  return translated && commandIds.has(translated) ? translated : null;
}

export function getDefaultImportCommandIds(): Set<string> {
  return new Set(ATHAS_BUILT_IN_COMMAND_IDS);
}

export function importVsCodeKeybindings(
  values: unknown[],
  { commandIds, platform }: VsCodeImportOptions,
): VsCodeImportResult {
  const keybindings: Keybinding[] = [];
  const issues: KeybindingImportIssue[] = [];
  let usesVsCodeSyntax = false;

  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];

    if (!isRecord(value) || typeof value.command !== "string") {
      issues.push({ index, reason: "invalid-entry" });
      continue;
    }

    const rawCommand = value.command.trim();
    if (!rawCommand) {
      issues.push({ index, reason: "empty-command" });
      continue;
    }

    const isRemoval = rawCommand.startsWith("-");
    const sourceCommand = isRemoval ? rawCommand.slice(1).trim() : rawCommand;
    const command = translateCommand(sourceCommand, commandIds);

    if (
      isRemoval ||
      command !== sourceCommand ||
      "mac" in value ||
      "win" in value ||
      "linux" in value ||
      "systemWide" in value
    ) {
      usesVsCodeSyntax = true;
    }

    if (!command) {
      issues.push({ index, reason: "unknown-command", command: sourceCommand });
      continue;
    }

    const rawKey = getPlatformKey(value, platform);
    const key = rawKey ? normalizeVsCodeKey(rawKey, platform) : null;
    if (!key) {
      issues.push({ index, reason: "unsupported-key", command: sourceCommand });
      continue;
    }

    const when = translateWhenClause(value.when, platform);
    if (when === null) {
      issues.push({ index, reason: "unsupported-when", command: sourceCommand });
      continue;
    }

    const isNativeCommand = command === sourceCommand;
    if (!isRemoval && "args" in value && !isNativeCommand) {
      issues.push({ index, reason: "unsupported-arguments", command: sourceCommand });
      continue;
    }

    const keybinding: Keybinding = {
      key,
      command,
      source: "user",
      enabled: !isRemoval,
    };

    if (when) keybinding.when = when;
    if (!isRemoval && isNativeCommand && "args" in value) keybinding.args = value.args;

    keybindings.push(keybinding);
  }

  return {
    format: usesVsCodeSyntax ? "vscode" : "athas",
    keybindings: usesVsCodeSyntax
      ? keybindings.map((keybinding) => ({ ...keybinding, replaceDefaults: false }))
      : keybindings.reverse(),
    issues,
  };
}
