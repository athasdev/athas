/**
 * Core types for the vim command system
 */

import type { Position } from "@/types/editor-types";

/**
 * Represents a range in the editor (for motions and text objects)
 */
export interface VimRange {
  start: Position;
  end: Position;
  inclusive?: boolean; // Whether the end position is included
  linewise?: boolean; // Whether this is a line-wise operation
}

/**
 * Editor context passed to operators and motions
 */
export interface EditorContext {
  lines: string[];
  content: string;
  cursor: Position;
  activeBufferId: string | null;
  updateContent: (newContent: string) => void;
  setCursorPosition: (position: Position) => void;
}

/**
 * A motion calculates a range from a starting position
 */
export interface MotionCalculateMeta {
  explicitCount?: boolean;
}

export interface Motion {
  name: string;
  /**
   * Calculate the range for this motion
   * @param cursor Starting cursor position
   * @param lines Editor lines
   * @param count Optional count multiplier (e.g., 3w means count=3)
   * @returns The range this motion covers
   */
  calculate: (
    cursor: Position,
    lines: string[],
    count?: number,
    meta?: MotionCalculateMeta,
  ) => VimRange;
  /**
   * Whether this motion is linewise by default
   */
  linewise?: boolean;
}

/**
 * An operator performs an action on a range
 */
export interface Operator {
  name: string;
  /**
   * Execute the operator on the given range
   */
  execute: (range: VimRange, context: EditorContext) => void;
  /**
   * Whether this operator can be repeated with dot command
   */
  repeatable?: boolean;
  /**
   * Whether this operator enters insert mode after execution (like c)
   */
  entersInsertMode?: boolean;
}

/**
 * A text object defines a range based on surrounding context
 * (e.g., "inside word", "around parentheses")
 */
export interface TextObject {
  name: string;
  /**
   * Calculate the range for this text object
   * @param cursor Current cursor position
   * @param lines Editor lines
   * @param mode 'inner' for i{object}, 'around' for a{object}
   * @returns The range this text object covers
   */
  calculate: (cursor: Position, lines: string[], mode: "inner" | "around") => VimRange | null;
}

/**
 * A simple action that doesn't take motions or text objects
 */
export interface Action {
  name: string;
  execute: (context: EditorContext) => void;
  repeatable?: boolean;
  entersInsertMode?: boolean;
}

/**
 * Parsed vim command structure
 */
export interface VimCommand {
  count?: number;
  operator?: string;
  motion?: string;
  textObject?: {
    mode: "inner" | "around";
    object: string;
  };
  action?: string;
  register?: string;
}

/**
 * Command to be stored for repeat (dot command)
 */
export interface RepeatableCommand {
  type: "operator" | "action";
  operator?: string;
  motion?: string;
  textObject?: {
    mode: "inner" | "around";
    object: string;
  };
  count?: number;
  // For actions like x, ~, etc.
  actionName?: string;
}
