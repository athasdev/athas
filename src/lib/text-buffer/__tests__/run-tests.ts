#!/usr/bin/env bun

import { runPerformanceComparison, runPieceTreeTests } from "./test-piece-tree";

console.log("Piece Tree Test Suite\n");

try {
  runPieceTreeTests();
  console.log(`\n${"=".repeat(60)}\n`);
  runPerformanceComparison();
  console.log("\nAll tests completed successfully.");
} catch (error) {
  console.error("Test failed:", error);
  process.exit(1);
}
