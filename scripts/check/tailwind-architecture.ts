const disallowedPatterns = [
  {
    pattern: /\bcustom-scrollbar(?:-auto|-thin)?\b/g,
    message: "use the shared ScrollArea primitive or Tailwind scrollbar utilities",
  },
  {
    pattern: /\bscrollbar-hidden\b/g,
    message: "use the canonical scrollbar-none utility",
  },
  {
    pattern: /\[scrollbar-gutter:stable\]/g,
    message: "use Tailwind's scrollbar-gutter-stable utility",
  },
  {
    pattern:
      /(?:duration-\(--app-duration-(?:fast|normal)\)|ease-\(--app-ease-smooth\)|scale-\(--app-press-scale\)|rounded-\(--athas-chrome-radius\)|(?:gap|mt|py)-\(--athas-chrome-gap(?:-tight|-loose)?\)|(?:px|pr|pl)-\(--athas-chrome-padding-inline\)|(?:h|min-h|max-w|w|size|right|px|pr)-\(--athas-(?:title-bar-height|footer-height|pane-header-height|tab-bar-height|tab-height|tab-max-width|sidebar-header-height|workbench-gap|chrome-control-height|chrome-hit-target)\)|leading-\(--athas-chrome-line-height\)|bg-\(--editor-bg\))/g,
    message: "use the semantic Tailwind v4 theme utility registered in theme.css",
  },
] as const;

export function findTailwindArchitectureViolations(path: string, source: string): string[] {
  const errors: string[] = [];

  for (const { pattern, message } of disallowedPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      errors.push(`${path}:${line}: ${message}: ${match[0]}`);
    }
  }

  return errors;
}

if (import.meta.main) {
  const sourceGlob = new Bun.Glob("src/**/*.{css,ts,tsx}");
  const errors: string[] = [];

  for await (const path of sourceGlob.scan({ cwd: ".", onlyFiles: true })) {
    errors.push(...findTailwindArchitectureViolations(path, await Bun.file(path).text()));
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  console.log("Tailwind architecture checks passed.");
}
