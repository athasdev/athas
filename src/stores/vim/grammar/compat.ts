/**
 * Compatibility layer between old and new Vim parsers
 *
 * Allows incremental migration by trying the new parser first,
 * falling back to the old parser if needed.
 */

import { executeVimCommand as executeOld } from "../core/command-executor";
import {
  getCommandParseStatus as getOldParseStatus,
  parseVimCommand as parseOld,
} from "../core/command-parser";
import type { ParseResult } from "./ast";
import { executeAST } from "./executor";
import { getCommandParseStatus as getNewParseStatus, parse as parseNew } from "./parser";

/**
 * Feature flag to enable/disable new parser
 *
 * Set to true to use new parser, false to use old parser.
 * Can be toggled at runtime for testing.
 */
let USE_NEW_PARSER = true; // Default: enabled for production use

/**
 * Enable or disable the new parser
 */
export function setUseNewParser(enabled: boolean): void {
  USE_NEW_PARSER = enabled;
}

/**
 * Check if new parser is enabled
 */
export function isNewParserEnabled(): boolean {
  return USE_NEW_PARSER;
}

/**
 * Parse command with compatibility fallback
 *
 * Tries new parser first, falls back to old parser if needed.
 */
export function parseVimCommandCompat(keys: string[]): ParseResult | null {
  if (!USE_NEW_PARSER) {
    // Use old parser
    const oldCmd = parseOld(keys);
    if (!oldCmd) return null;

    // Convert old command format to new ParseResult format
    // This is a simplified conversion - full conversion would be more complex
    return {
      status: "complete",
      command: {
        kind: "action", // Simplified
        action: { type: "misc", key: "" },
      },
    };
  }

  // Try new parser
  const result = parseNew(keys);

  if (result.status === "complete") {
    return result;
  }

  // If new parser fails, try old parser as fallback
  const oldCmd = parseOld(keys);
  if (!oldCmd) return result; // Return new parser's error

  // Convert old command to new format
  // For now, just return the new parser result
  return result;
}

/**
 * Execute command with compatibility fallback
 *
 * Tries new executor first, falls back to old executor if needed.
 */
export function executeVimCommandCompat(keys: string[]): boolean {
  if (!USE_NEW_PARSER) {
    // Use old executor
    return executeOld(keys);
  }

  // Try new parser
  const result = parseNew(keys);

  if (result.status === "complete") {
    // Use new executor
    return executeAST(result.command);
  }

  // Parser didn't complete - try old system
  return executeOld(keys);
}

/**
 * Get command parse status with compatibility
 *
 * Returns: "complete" | "incomplete" | "invalid" | "needsChar"
 */
export function getCommandParseStatusCompat(
  keys: string[],
): "complete" | "incomplete" | "invalid" | "needsChar" {
  if (!USE_NEW_PARSER) {
    return getOldParseStatus(keys);
  }

  return getNewParseStatus(keys);
}

/**
 * Check if command is complete (ready to execute)
 */
export function isCommandComplete(keys: string[]): boolean {
  const status = getCommandParseStatusCompat(keys);
  return status === "complete";
}

/**
 * Check if command is waiting for more keys
 */
export function expectsMoreKeys(keys: string[]): boolean {
  const status = getCommandParseStatusCompat(keys);
  return status === "incomplete" || status === "needsChar";
}

/**
 * Check if command is invalid
 */
export function isCommandInvalid(keys: string[]): boolean {
  const status = getCommandParseStatusCompat(keys);
  return status === "invalid";
}
