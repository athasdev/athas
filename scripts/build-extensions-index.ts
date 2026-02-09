import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type RegistryEntry = {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  publisher?: string;
  category?: string;
  icon?: string;
  manifestUrl?: string;
  downloads?: number;
  rating?: number;
};

type Registry = {
  extensions?: RegistryEntry[];
};

function normalizeCategory(raw?: string) {
  const value = (raw ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();

  if (value.includes("icon") && value.includes("theme")) return "Icon Themes";
  if (value === "icon" || value === "icon theme" || value === "icon themes") return "Icon Themes";
  if (value === "theme" || value === "themes") return "Themes";
  if (value === "language" || value === "languages" || value === "lang") return "Languages";

  return "Languages";
}

const registryPath = join(process.cwd(), "extensions", "registry.json");
const outputPath = join(process.cwd(), "extensions", "index.json");

const registryRaw = await readFile(registryPath, "utf8");
const registry = JSON.parse(registryRaw) as Registry;

const extensions = (registry.extensions ?? []).map((entry) => ({
  id: entry.id ?? "",
  name: entry.displayName ?? entry.name ?? entry.id ?? "Untitled",
  description: entry.description ?? "",
  version: entry.version ?? "0.0.0",
  author: entry.publisher ?? "Athas",
  category: normalizeCategory(entry.category),
  icon: entry.icon ?? "",
  manifestUrl: entry.manifestUrl ?? "",
  downloads: entry.downloads ?? 0,
  rating: entry.rating ?? 0,
}));

await writeFile(outputPath, JSON.stringify(extensions, null, 2) + "\n");
console.log(`Wrote ${extensions.length} extensions to ${outputPath}`);
