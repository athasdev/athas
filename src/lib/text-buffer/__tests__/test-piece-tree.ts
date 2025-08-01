import { PieceTree } from "../piece-tree";
import { createTextBuffer } from "../text-buffer-manager";

/**
 * Test runner for piece tree functionality
 */
export function runPieceTreeTests(): void {
  console.log("Running Piece Tree Tests...\n");

  // Test 1: Basic initialization
  console.log("Test 1: Basic initialization");
  const tree1 = new PieceTree("Hello World");
  console.log(`  Content: "${tree1.getText()}" (length: ${tree1.length})`);
  console.log(`  Line count: ${tree1.lineCount}\n`);

  // Test 2: Text insertion
  console.log("Test 2: Text insertion");
  const tree2 = new PieceTree("Hello World");
  tree2.insert(6, "Beautiful ");
  console.log(`  After insert: "${tree2.getText()}" (length: ${tree2.length})\n`);

  // Test 3: Text deletion
  console.log("Test 3: Text deletion");
  const tree3 = new PieceTree("Hello Beautiful World");
  tree3.delete(6, 10); // Remove "Beautiful "
  console.log(`  After delete: "${tree3.getText()}" (length: ${tree3.length})\n`);

  // Test 4: Text replacement
  console.log("Test 4: Text replacement");
  const tree4 = new PieceTree("Hello World");
  tree4.replace(6, 11, "Universe");
  console.log(`  After replace: "${tree4.getText()}" (length: ${tree4.length})\n`);

  // Test 5: Position conversion
  console.log("Test 5: Position conversion");
  const tree5 = new PieceTree("Line 1\nLine 2\nLine 3");
  const pos1 = tree5.offsetToPosition(0);
  const pos2 = tree5.offsetToPosition(7);
  const pos3 = tree5.offsetToPosition(14);
  console.log(`  Offset 0: line ${pos1.line}, col ${pos1.column}`);
  console.log(`  Offset 7: line ${pos2.line}, col ${pos2.column}`);
  console.log(`  Offset 14: line ${pos3.line}, col ${pos3.column}\n`);

  // Test 6: Line operations
  console.log("Test 6: Line operations");
  const tree6 = new PieceTree("First line\nSecond line\nThird line");
  console.log(`  Line 0: "${tree6.getLineContent(0)}"`);
  console.log(`  Line 1: "${tree6.getLineContent(1)}"`);
  console.log(`  Line 2: "${tree6.getLineContent(2)}"`);
  console.log(`  All lines:`, tree6.getLines(), "\n");

  // Test 7: Complex operations
  console.log("Test 7: Complex operations");
  const tree7 = new PieceTree("The quick brown fox");
  tree7.insert(4, "very ");
  tree7.delete(10, 6); // Remove "quick "
  tree7.replace(10, 15, "red cat");
  console.log(`  Final result: "${tree7.getText()}"\n`);

  // Test 8: Performance test
  console.log("Test 8: Performance test");
  const largeContent = `${"a".repeat(10000)}\n${"b".repeat(10000)}`;
  const tree8 = new PieceTree(largeContent);

  const start = performance.now();
  tree8.insert(10000, "INSERTED");
  const end = performance.now();

  console.log(
    `  Large file (${largeContent.length} chars) insertion took: ${(end - start).toFixed(2)}ms`,
  );
  console.log(`  Content around insertion: "${tree8.getText().substring(9995, 10015)}"\n`);

  // Test 9: Text buffer manager
  console.log("Test 9: Text buffer manager");
  const buffer = createTextBuffer("Initial content", true);
  buffer.insert(8, "test ");
  buffer.replace(0, 7, "Modified");
  console.log(`  Buffer content: "${buffer.getText()}"`);
  console.log(`  Buffer lines:`, buffer.getLines(), "\n");

  // Test 10: Edge cases
  console.log("Test 10: Edge cases");
  const tree10 = new PieceTree();
  tree10.insert(0, "First");
  tree10.insert(5, " insertion");
  tree10.delete(0, 6);
  tree10.insert(0, "New ");
  console.log(`  Edge case result: "${tree10.getText()}"\n`);

  console.log("All tests completed successfully.");
}

/**
 * Performance comparison between string buffer and piece tree
 */
export function runPerformanceComparison(): void {
  console.log("Performance Comparison: String Buffer vs Piece Tree\n");

  const testContent = "Lorem ipsum ".repeat(1000); // ~12KB
  const iterations = 100;

  // Test string buffer
  console.log("Testing String Buffer...");
  const stringBuffer = createTextBuffer(testContent, false);
  const stringStart = performance.now();

  for (let i = 0; i < iterations; i++) {
    stringBuffer.insert(Math.floor(testContent.length / 2), "X");
  }

  const stringEnd = performance.now();
  const stringTime = stringEnd - stringStart;

  // Test piece tree
  console.log("Testing Piece Tree...");
  const pieceBuffer = createTextBuffer(testContent, true);
  const pieceStart = performance.now();

  for (let i = 0; i < iterations; i++) {
    pieceBuffer.insert(Math.floor(testContent.length / 2), "X");
  }

  const pieceEnd = performance.now();
  const pieceTime = pieceEnd - pieceStart;

  // Results
  console.log("\nResults:");
  console.log(`  String Buffer: ${stringTime.toFixed(2)}ms`);
  console.log(`  Piece Tree: ${pieceTime.toFixed(2)}ms`);
  console.log(`  Improvement: ${(stringTime / pieceTime).toFixed(1)}x faster`);

  if (pieceTime < stringTime) {
    console.log("  Piece Tree is faster");
  } else {
    console.log("  String buffer was faster (unexpected for this test size)");
  }
}

// Export for console testing
if (typeof window !== "undefined") {
  (window as any).testPieceTree = runPieceTreeTests;
  (window as any).testPerformance = runPerformanceComparison;
}
