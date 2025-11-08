/**
 * Central registry for all vim operators
 */

import type { Operator } from "../core/types";
import { changeOperator } from "./change-operator";
import { deleteOperator } from "./delete-operator";
import { indentOperator } from "./indent-operator";
import { outdentOperator } from "./outdent-operator";
import { yankOperator } from "./yank-operator";

/**
 * Registry of all available operators
 */
export const operatorRegistry: Record<string, Operator> = {
  d: deleteOperator,
  c: changeOperator,
  y: yankOperator,
  ">": indentOperator,
  "<": outdentOperator,
};

/**
 * Get an operator by key
 */
export const getOperator = (key: string): Operator | undefined => {
  return operatorRegistry[key];
};

/**
 * Check if a key is a registered operator
 */
export const isOperator = (key: string): boolean => {
  return key in operatorRegistry;
};

/**
 * Get all operator keys
 */
export const getOperatorKeys = (): string[] => {
  return Object.keys(operatorRegistry);
};

export { changeOperator } from "./change-operator";
// Re-export operators
export { deleteOperator } from "./delete-operator";
export { getVimClipboard, setVimClipboard, yankOperator } from "./yank-operator";
