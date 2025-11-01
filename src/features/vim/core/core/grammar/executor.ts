/**
 * AST-based Vim command executor
 *
 * Executes parsed AST commands by coordinating with operators, motions,
 * text objects, actions, and the register system.
 */

import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import {
  type EditorContext,
  getAction,
  getMotion,
  getOperator,
  getTextObject,
  type VimRange,
} from "@/features/vim/core";
import { createVimEditing } from "@/features/vim/stores/vim-editing";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useEditorStateStore } from "@/stores/editor-cursor-store";
import type { Command, Motion } from "./ast";
import { getMotionInfo } from "./motion-kind";
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

    // Handle MOTION commands (standalone cursor movement)
    if (normalized.kind === "motion") {
      return executeMotion(normalized, context, count);
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

    if (!register.content) {
      console.warn("Nothing in register to paste");
      return false;
    }

    const editing = createVimEditing();

    for (let i = 0; i < count; i++) {
      if (action.which === "p") {
        editing.paste(register.content, register.type);
      } else {
        editing.pasteAbove(register.content, register.type);
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
    const vimStore = useVimStore.getState();

    // Collect all deleted characters
    let deletedContent = "";
    const currentContent = context.content;
    let currentOffset = context.cursor.offset;

    for (let i = 0; i < count; i++) {
      if (action.operation === "deleteChar") {
        if (currentOffset < currentContent.length) {
          deletedContent += currentContent[currentOffset];
        }
        editing.deleteChar();
      } else {
        if (currentOffset > 0) {
          deletedContent = currentContent[currentOffset - 1] + deletedContent;
          currentOffset--;
        }
        editing.deleteCharBefore();
      }
    }

    // Store deleted content in register
    if (deletedContent) {
      vimStore.actions.setRegisterContent(registerName, deletedContent, "char");
    }

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
    const lastCmd = vimStore.actions.getLastRepeatableCommand();

    if (!lastCmd) {
      console.warn("No command to repeat");
      return false;
    }

    // Re-execute the last command (recursive call)
    // The lastCmd is already normalized and validated, so we can execute it directly
    return executeAST(lastCmd);
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
 * Execute a standalone motion command (cursor movement)
 */
function executeMotion(
  cmd: Extract<Command, { kind: "motion" }>,
  context: EditorContext,
  count: number,
): boolean {
  const { motion } = cmd;

  // Get motion key for registry lookup
  const motionKey = getMotionKey(motion);
  if (!motionKey) return false;

  // Get motion implementation
  const motionImpl = getMotion(motionKey);
  if (!motionImpl) {
    console.warn(`Motion not implemented: ${motionKey}`);
    return false;
  }

  // Calculate where the motion would move the cursor
  const range = motionImpl.calculate(context.cursor, context.lines, count, {
    explicitCount: count > 1,
  });

  if (!range) return false;

  // Move cursor to the end position of the range
  context.setCursorPosition({
    line: range.end.line,
    column: range.end.column,
    offset: calculateOffsetFromPosition(range.end.line, range.end.column, context.lines),
  });

  return true;
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

  // Determine motion kind using motion-kind system
  const motionInfo = getMotionInfo(motion);

  // Apply forced kind if specified, otherwise use motion's natural kind
  if (forcedKind) {
    range.linewise = forcedKind === "line";
    // TODO: Handle blockwise
  } else {
    range.linewise = motionInfo.kind === "line";
  }

  // Also apply inclusivity from motion info if not already set
  if (range.inclusive === undefined) {
    range.inclusive = motionInfo.inclusive === "inclusive";
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
 * Store command for dot repeat
 */
function storeForRepeat(cmd: Command): void {
  const vimStore = useVimStore.getState();

  // Store the normalized command for repeat
  // Deep clone to avoid reference issues
  const clonedCmd = JSON.parse(JSON.stringify(cmd));
  vimStore.actions.setLastRepeatableCommand(clonedCmd);
}

/**
 * Get the current editor context
 */
function getEditorContext(): EditorContext | null {
  const cursorState = useEditorStateStore.getState();
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
