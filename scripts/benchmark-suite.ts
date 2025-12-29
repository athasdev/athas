import { writeFileSync } from "fs";
import { join } from "path";

const BENCHMARKS = {
  small: { lines: 100, name: "benchmark_small.md" },
  medium: { lines: 2000, name: "benchmark_medium.md" },
  large: { lines: 20000, name: "benchmark_large.md" },
};

const generateContent = (lineCount: number) => {
  let content = "# Benchmark File\n\n";
  for (let i = 0; i < lineCount; i++) {
    content += `## Section ${i}\n`;
    content += `This is line ${i} of our benchmark file. It contains some **bold**, *italic*, and \`code\` elements to test parsing.\n`;
    if (i % 10 === 0) {
      content += "```typescript\nconsole.log('Code block benchmark');\n```\n";
    }
  }
  return content;
};

Object.entries(BENCHMARKS).forEach(([key, config]) => {
  const filePath = join(process.cwd(), config.name);
  console.log(`Generating ${key} benchmark (${config.lines} lines) to ${config.name}...`);
  writeFileSync(filePath, generateContent(config.lines));
});

console.log("Benchmark suite generated successfully.");
