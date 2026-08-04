const storeGlob = new Bun.Glob("src/**/*.{ts,tsx}");
const sourceGlob = new Bun.Glob("src/**/*.{ts,tsx}");
const exportedStorePattern = /export const (use[A-Z][A-Za-z0-9]*Store)\b/g;
const wholeStoreSubscriptionPattern = /\buse[A-Z][A-Za-z0-9]*Store\(\)/g;
const errors: string[] = [];

for await (const path of storeGlob.scan({ cwd: ".", onlyFiles: true })) {
  const source = await Bun.file(path).text();
  const exportedStores = [...source.matchAll(exportedStorePattern)];
  if (exportedStores.length === 0) {
    continue;
  }

  if (!source.includes("createSelectors") && !source.includes("createWorkspaceScopedStore")) {
    errors.push(`${path}: exported React stores must use createSelectors`);
  }

  if (!source.includes("actions:")) {
    errors.push(`${path}: store actions must be grouped under actions`);
  }

  if (source.includes("storeActions")) {
    errors.push(`${path}: use actions instead of storeActions`);
  }
}

for await (const path of sourceGlob.scan({ cwd: ".", onlyFiles: true })) {
  const source = await Bun.file(path).text();
  for (const match of source.matchAll(wholeStoreSubscriptionPattern)) {
    const line = source.slice(0, match.index).split("\n").length;
    errors.push(`${path}:${line}: select only the store state this render needs`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Zustand architecture checks passed.");
