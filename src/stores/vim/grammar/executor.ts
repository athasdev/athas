/**
 * AST-based Vim command executor
 *
 * Executes parsed AST commands by coordinating with operators, motions,
 * text objects, actions, and the register system.
 */

import { useBufferStore } from "@/stores/buffer-store";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { createVimEditing } from "@/stores/vim-editing";
import { useVimStore } from "@/stores/vim-store";
import { calculateOffsetFromPosition } from "@/utils/editor-position";
import { getAction } from "../actions";
import { getMotion } from "../core/motion-registry";
import { getTextObject } from "../core/text-objects";
import type { EditorContext, VimRange } from "../core/types";
import { getOperator } from "../operators";
import type { Command, Motion } from "./ast";
import { effectiveCount, getRegisterName, isRepeatable, normalize } from "./normalize";

/**
 * Execute an AST command
 *
 * @param cmd - Parsed command AST
 * @returns True if execution succeeded
 */
export function executeAST(cmd: Command): boolean {
  // Normalize the command (expand aliases like D, C, S, Y)
  const normalized = normalize(cmd);

  // Get editor context
  const context = getEditorContext();
  if (!context) return false;

  const count = effectiveCount(normalized);
  const registerName = getRegisterName(normalized);

  try {
    // Handle ACTION commands
    if (normalized.kind === "action") {
      return executeAction(normalized, context, count, registerName);
    }

    // Handle OPERATOR commands
    if (normalized.kind === "operator") {
      return executeOperator(normalized, context, count, registerName);
    }

    return false;
  } catch (error) {
    console.error("Error executing vim command:", error);
    return false;
  }
}

/**
 * Execute an action command
 */
function executeAction(
  cmd: Extract<Command, { kind: "action" }>,
  context: EditorContext,
  count: number,
  registerName: string,
): boolean {
  const { action } = cmd;

  // Put actions (p, P)
  if (action.type === "put") {
    const vimStore = useVimStore.getState();
    const register = vimStore.actions.getRegisterContent(registerName);

    for (let i = 0; i < count; i++) {
      if (action.which === "p") {
        pastePutAction(context, register.content, register.type);
      } else {
        pastePutBeforeAction(context, register.content, register.type);
      }
    }

    // Store for repeat
    if (isRepeatable(cmd)) {
      storeForRepeat(cmd);
    }

    return true;
  }

  // Character replace actions (r, gr)
  if (action.type === "charReplace") {
    const editing = createVimEditing();

    for (let i = 0; i < count; i++) {
      editing.replaceChar(action.char);
    }

    // Store for repeat
    if (isRepeatable(cmd)) {
      storeForRepeat(cmd);
    }

    return true;
  }

  // Mode change actions (i, a, A, I, o, O, s)
  if (action.type === "modeChange") {
    return executeModeChange(action.mode, context, count);
  }

  // Single char operations (x, X)
  if (action.type === "singleChar") {
    const editing = createVimEditing();
    const _vimStore = useVimStore.getState();

    for (let i = 0; i < count; i++) {
      if (action.operation === "deleteChar") {
        editing.deleteChar();
      } else {
        editing.deleteCharBefore();
      }
    }

    // Store deleted content in register
    // (deleteChar and deleteCharBefore already handle this)

    // Store for repeat
    if (isRepeatable(cmd)) {
      storeForRepeat(cmd);
    }

    return true;
  }

  // Undo
  if (action.type === "undo") {
    const editing = createVimEditing();
    for (let i = 0; i < count; i++) {
      editing.undo();
    }
    return true;
  }

  // Redo
  if (action.type === "redo") {
    const editing = createVimEditing();
    for (let i = 0; i < count; i++) {
      editing.redo();
    }
    return true;
  }

  // Repeat (dot command)
  if (action.type === "repeat") {
    const vimStore = useVimStore.getState();
    const lastOp = vimStore.actions.getLastOperation();

    if (lastOp?.keys) {
      // Re-execute the last operation (not implemented yet - needs recursion guard)
      // For now, return true to avoid error
      console.warn("Dot repeat not fully implemented in new executor yet");
      return true;
    }

    return false;
  }

  // Misc actions (J, ~, etc.) - delegate to old action system
  if (action.type === "misc") {
    const oldAction = getAction(action.key);
    if (!oldAction) return false;

    for (let i = 0; i < count; i++) {
      oldAction.execute(context);
    }

    // Store for repeat
    if (isRepeatable(cmd)) {
      storeForRepeat(cmd);
    }

    return true;
  }

  return false;
}

/**
 * Execute an operator command
 */
function executeOperator(
  cmd: Extract<Command, { kind: "operator" }>,
  context: EditorContext,
  count: number,
  _registerName: string,
): boolean {
  const { operator, target } = cmd;

  if (!target) {
    return false; // Incomplete command
  }

  // Get the operator
  const op = getOperator(operator);
  if (!op) return false;

  // Get the range based on target type
  let range: VimRange | null = null;

  if (target.type === "textObject") {
    // Text object
    const textObj = getTextObject(target.object);
    if (!textObj) return false;

    range = textObj.calculate(context.cursor, context.lines, target.mode);
    if (!range) return false;
  } else if (target.type === "motion") {
    // Motion
    range = calculateMotionRange(target.motion, context, count, target.forced);
    if (!range) return false;
  }

  // Final null check (should never happen due to earlier checks, but TypeScript needs it)
  if (!range) return false;

  // Store for repeat
  if (isRepeatable(cmd)) {
    storeForRepeat(cmd);
  }

  // Execute the operator on the range
  // TODO: Update operators to accept register parameter
  op.execute(range, context);

  // Handle mode transitions for operators that enter insert mode
  if (op.entersInsertMode) {
    const vimStore = useVimStore.getState();
    vimStore.actions.setMode("insert");
  }

  return true;
}

/**
 * Calculate range for a motion
 */
function calculateMotionRange(
  motion: Motion,
  context: EditorContext,
  count: number,
  forcedKind?: "char" | "line" | "block",
): VimRange | null {
  // Map AST motion to motion key for registry lookup
  const motionKey = getMotionKey(motion);
  if (!motionKey) return null;

  const motionImpl = getMotion(motionKey);
  if (!motionImpl) return null;

  // Calculate the range
  const range = motionImpl.calculate(context.cursor, context.lines, count, {
    explicitCount: count > 1,
  });

  // Apply forced kind if specified
  if (forcedKind) {
    range.linewise = forcedKind === "line";
    // TODO: Handle blockwise
  }

  return range;
}

/**
 * Get motion key for registry lookup from AST motion
 */
function getMotionKey(motion: Motion): string | null {
  if (motion.type === "simple") {
    return motion.key;
  }

  if (motion.type === "char") {
    // For char motions like f/F/t/T, we need special handling
    // For now, return the motion key - char will be handled separately
    return motion.key;
  }

  if (motion.type === "searchRepeat") {
    return motion.key;
  }

  if (motion.type === "mark") {
    return motion.style;
  }

  if (motion.type === "prefixed") {
    return motion.head + motion.tail;
  }

  if (motion.type === "search") {
    return motion.dir === "fwd" ? "/" : "?";
  }

  return null;
}

/**
 * Execute mode change action
 */
function executeModeChange(mode: string, context: EditorContext, _count: number): boolean {
  const editing = createVimEditing();
  const vimStore = useVimStore.getState();

  switch (mode) {
    case "insert": // i
      vimStore.actions.setMode("insert");
      return true;

    case "append": {
      // a
      // Move cursor one position right before entering insert mode
      const currentPos = context.cursor;
      const lines = context.lines;
      const newColumn = Math.min(lines[currentPos.line].length, currentPos.column + 1);
      const newOffset = calculateOffsetFromPosition(currentPos.line, newColumn, lines);
      context.setCursorPosition({ line: currentPos.line, column: newColumn, offset: newOffset });

      vimStore.actions.setMode("insert");
      return true;
    }

    case "appendLine": // A
      editing.appendToLine();
      vimStore.actions.setMode("insert");
      return true;

    case "insertLineStart": // I
      editing.insertAtLineStart();
      vimStore.actions.setMode("insert");
      return true;

    case "openBelow": // o
      editing.openLineBelow();
      vimStore.actions.setMode("insert");
      return true;

    case "openAbove": // O
      editing.openLineAbove();
      vimStore.actions.setMode("insert");
      return true;

    case "substitute": // s
      editing.substituteChar();
      vimStore.actions.setMode("insert");
      return true;

    default:
      return false;
  }
}

/**
 * Paste action (p)
 */
function pastePutAction(_context: EditorContext, content: string, type: "line" | "char"): void {
  const editing = createVimEditing();

  // Temporarily set the clipboard to the register content
  const vimStore = useVimStore.getState();
  const oldClipboard = vimStore.register;

  vimStore.actions.setRegister(content, type === "line");
  editing.paste();

  // Restore old clipboard
  vimStore.actions.setRegister(oldClipboard.text, oldClipboard.isLineWise);
}

/**
 * Paste before action (P)
 */
function pastePutBeforeAction(
  _context: EditorContext,
  content: string,
  type: "line" | "char",
): void {
  const editing = createVimEditing();

  // Temporarily set the clipboard to the register content
  const vimStore = useVimStore.getState();
  const oldClipboard = vimStore.register;

  vimStore.actions.setRegister(content, type === "line");
  editing.pasteAbove();

  // Restore old clipboard
  vimStore.actions.setRegister(oldClipboard.text, oldClipboard.isLineWise);
}

/**
 * Store command for dot repeat
 */
function storeForRepeat(cmd: Command): void {
  // For now, just log - full implementation requires storing AST
  // TODO: Store AST command for proper repeat
  console.log("Storing for repeat (not fully implemented):", cmd);
}

/**
 * Get the current editor context
 */
function getEditorContext(): EditorContext | null {
  const cursorState = useEditorCursorStore.getState();
  const viewState = useEditorViewStore.getState();
  const bufferState = useBufferStore.getState();
  const settingStore = useEditorSettingsStore.getState();

  const { cursorPosition } = cursorState;
  const { lines } = viewState;
  const { activeBufferId } = bufferState;
  const { tabSize } = settingStore;

  if (!lines || lines.length === 0) return null;

  const content = lines.join("\n");

  const updateContent = (newContent: string) => {
    if (activeBufferId) {
      bufferState.actions.updateBufferContent(activeBufferId, newContent);

      // Update textarea
      const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = newContent;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  };

  const setCursorPosition = (position: any) => {
    cursorState.actions.setCursorPosition(position);
  };

  return {
    lines,
    content,
    cursor: cursorPosition,
    activeBufferId,
    updateContent,
    setCursorPosition,
    tabSize,
  };
}
