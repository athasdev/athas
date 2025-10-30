/**
 * Command normalization and count handling
 *
 * Normalizes command aliases and provides utilities for count multiplication.
 */

import type { Command } from "./ast";

/**
 * Normalize a command by expanding aliases
 *
 * Aliases:
 * - D → d$ (delete to end of line)
 * - C → c$ (change to end of line)
 * - S → cc (substitute line)
 * - Y → yy (yank line)
 * - dd/yy/cc → d_/y_/c_ (doubled operators become linewise)
 *
 * The underscore (_) motion is a linewise motion to the first non-blank
 * character on [count]-1 lines below. Modeling dd as d_ preserves linewise semantics.
 */
export function normalize(cmd: Command): Command {
  // Handle action aliases
  if (cmd.kind === "action") {
    if (cmd.action.type === "misc") {
      const k = cmd.action.key;

      // D → d$ (delete to end of line)
      if (k === "D") {
        return {
          kind: "operator",
          reg: cmd.reg,
          countBefore: cmd.count,
          operator: "d",
          target: {
            type: "motion",
            motion: { type: "simple", key: "$" },
          },
        };
      }

      // C → c$ (change to end of line)
      if (k === "C") {
        return {
          kind: "operator",
          reg: cmd.reg,
          countBefore: cmd.count,
          operator: "c",
          target: {
            type: "motion",
            motion: { type: "simple", key: "$" },
          },
        };
      }

      // S → cc (substitute line)
      if (k === "S") {
        return {
          kind: "operator",
          reg: cmd.reg,
          countBefore: cmd.count,
          operator: "c",
          doubled: true,
          target: {
            type: "motion",
            motion: { type: "simple", key: "_" },
          },
        };
      }

      // Y → yy (yank line)
      if (k === "Y") {
        return {
          kind: "operator",
          reg: cmd.reg,
          countBefore: cmd.count,
          operator: "y",
          doubled: true,
          target: {
            type: "motion",
            motion: { type: "simple", key: "_" },
          },
        };
      }
    }

    return cmd;
  }

  // Handle operator doubling (dd, yy, cc, >>, etc.)
  // Normalize to operator + _ motion (linewise)
  if (cmd.kind === "operator" && cmd.doubled && !cmd.target) {
    return {
      ...cmd,
      doubled: true,
      target: {
        type: "motion",
        motion: { type: "simple", key: "_" },
      },
    };
  }

  return cmd;
}

/**
 * Calculate effective count for a command
 *
 * For actions: just the count (default 1)
 * For operators: countBefore * countAfter (default 1 each)
 *
 * Examples:
 * - 3dw → countBefore=3, countAfter=undefined → count=3
 * - d3w → countBefore=undefined, countAfter=3 → count=3
 * - 2d3w → countBefore=2, countAfter=3 → count=6
 * - 5dd → countBefore=5, doubled=true → count=5
 */
export function effectiveCount(cmd: Command): number {
  if (cmd.kind === "action") {
    return cmd.count ?? 1;
  }

  // For operators
  const a = cmd.countBefore ?? 1;
  const b = cmd.countAfter ?? 1;

  return a * b;
}

/**
 * Get the register to use for a command
 *
 * Returns the register name if specified, otherwise the default unnamed register (")
 */
export function getRegisterName(cmd: Command): string {
  if (cmd.kind === "action" && cmd.reg) {
    return cmd.reg.name;
  }

  if (cmd.kind === "operator" && cmd.reg) {
    return cmd.reg.name;
  }

  // Default to unnamed register
  return '"';
}

/**
 * Check if a command is repeatable (for dot command)
 *
 * Most commands that modify text are repeatable.
 * Navigation-only commands are not repeatable.
 */
export function isRepeatable(cmd: Command): boolean {
  if (cmd.kind === "action") {
    // Put, replace, mode changes, single char operations are repeatable
    if (
      cmd.action.type === "put" ||
      cmd.action.type === "charReplace" ||
      cmd.action.type === "modeChange" ||
      cmd.action.type === "singleChar"
    ) {
      return true;
    }

    // Misc actions: check specific keys
    if (cmd.action.type === "misc") {
      const k = cmd.action.key;
      // J (join lines), ~ (toggle case) are repeatable
      // D, C, S, Y are aliases (will be normalized to operators)
      return k === "J" || k === "~" || k === "D" || k === "C" || k === "S" || k === "Y";
    }

    // Undo, redo, repeat are not repeatable
    return false;
  }

  // All operators are repeatable
  return true;
}
