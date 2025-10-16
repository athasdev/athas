/**
 * Vim Command System - Main Entry Point
 *
 * This is a modular, extensible vim command system that supports:
 * - Text objects (iw, aw, i", a(, etc.)
 * - Motions (w, b, e, $, 0, f, t, etc.)
 * - Operators (d, c, y)
 * - Count support (3dw, 2ciw, d3w, etc.)
 * - Easy extension with new motions, operators, and text objects
 *
 * Architecture:
 *
 * 1. **Core Types** (core/types.ts)
 *    - Defines interfaces for Motion, Operator, TextObject, Range, etc.
 *
 * 2. **Text Objects** (core/text-objects.ts)
 *    - Implements iw, aw, i", a(, and other text objects
 *    - Easy to add new text objects by following the TextObject interface
 *
 * 3. **Motions** (motions/*.ts)
 *    - word-motions.ts: w, b, e, W, B, E
 *    - line-motions.ts: 0, $, ^, _
 *    - character-motions.ts: h, l, f, F, t, T, ;, ,
 *    - Each motion calculates a Range from current position
 *
 * 4. **Operators** (operators/*.ts)
 *    - delete-operator.ts: d operator
 *    - change-operator.ts: c operator
 *    - yank-operator.ts: y operator
 *    - Each operator acts on a Range
 *
 * 5. **Command Parser** (core/command-parser.ts)
 *    - Parses vim command sequences like "3dw", "ci(", "d2w"
 *    - Handles count before and after operator
 *    - Returns structured VimCommand object
 *
 * 6. **Command Executor** (core/command-executor.ts)
 *    - Executes parsed commands
 *    - Orchestrates motions, operators, and text objects
 *    - Manages editor context
 *
 * Usage Example:
 * ```typescript
 * import { executeVimCommand } from '@/stores/vim';
 *
 * // Execute "3dw" (delete 3 words forward)
 * executeVimCommand(['3', 'd', 'w']);
 *
 * // Execute "ciw" (change inner word)
 * executeVimCommand(['c', 'i', 'w']);
 *
 * // Execute "d2w" (delete 2 words)
 * executeVimCommand(['d', '2', 'w']);
 * ```
 *
 * Adding New Features:
 *
 * **Add a new motion:**
 * ```typescript
 * // In motions/custom-motions.ts
 * export const myMotion: Motion = {
 *   name: "my-motion",
 *   calculate: (cursor, lines, count) => {
 *     // Calculate and return Range
 *     return { start: cursor, end: newPosition };
 *   }
 * };
 *
 * // In core/motion-registry.ts
 * import { myMotion } from '../motions/custom-motions';
 * motionRegistry['m'] = myMotion;
 * ```
 *
 * **Add a new operator:**
 * ```typescript
 * // In operators/custom-operator.ts
 * export const myOperator: Operator = {
 *   name: "my-operator",
 *   execute: (range, context) => {
 *     // Perform operation on range
 *   },
 *   repeatable: true,
 * };
 *
 * // In operators/index.ts
 * import { myOperator } from './custom-operator';
 * operatorRegistry['x'] = myOperator;
 * ```
 *
 * **Add a new text object:**
 * ```typescript
 * // In core/text-objects.ts
 * textObjects['e'] = {
 *   name: "my-text-object",
 *   calculate: (cursor, lines, mode) => {
 *     // Return Range or null
 *   }
 * };
 * ```
 */

// Command execution
export { canExecuteCommand, executeVimCommand } from "./core/command-executor";
export {
  expectsMoreKeys,
  getEffectiveCount,
  isCommandComplete,
  parseVimCommand,
} from "./core/command-parser";
// Registries
export { getMotion, getMotionKeys, isMotion } from "./core/motion-registry";
export { getTextObject } from "./core/text-objects";
// Core types
export type {
  EditorContext,
  Motion,
  Operator,
  RepeatableCommand,
  TextObject,
  VimCommand,
  VimRange,
} from "./core/types";
export * from "./motions/character-motions";
export * from "./motions/line-motions";

// Motions (for external use if needed)
export * from "./motions/word-motions";
// Operators
export {
  changeOperator,
  deleteOperator,
  getOperator,
  getOperatorKeys,
  getVimClipboard,
  isOperator,
  setVimClipboard,
  yankOperator,
} from "./operators";
