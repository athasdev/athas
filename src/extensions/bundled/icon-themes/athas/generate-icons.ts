import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type IconKind =
  | "file"
  | "code"
  | "brackets"
  | "react"
  | "database"
  | "gear"
  | "package"
  | "terminal"
  | "image"
  | "document"
  | "markdown"
  | "lock"
  | "test"
  | "cloud"
  | "git"
  | "docker"
  | "palette"
  | "book"
  | "audio"
  | "video"
  | "font"
  | "rust"
  | "python"
  | "go"
  | "java"
  | "swift"
  | "zig"
  | "angular"
  | "archive"
  | "bolt"
  | "compass"
  | "cube"
  | "flame"
  | "graph"
  | "key"
  | "layers"
  | "leaf"
  | "mobile"
  | "network"
  | "pen"
  | "sparkles"
  | "shield"
  | "warning";

interface FileIcon {
  id: string;
  label: string;
  color: string;
  accent: string;
  kind: IconKind;
  text?: string;
}

interface FolderIcon {
  id: string;
  label: string;
  color: string;
  accent: string;
  mark?: string;
}

const root = dirname(fileURLToPath(import.meta.url));

interface ThemeVariant {
  id: string;
  name: string;
  description: string;
  directory: string;
  background: string;
  transform: (icon: Pick<FileIcon, "color" | "accent">) => Pick<FileIcon, "color" | "accent">;
}

const fileIcons: FileIcon[] = [
  { id: "file", label: "File", color: "#8A98A8", accent: "#C8D1DC", kind: "file" },
  { id: "text", label: "Text", color: "#7D8CA1", accent: "#C9D4E1", kind: "document", text: "TXT" },
  { id: "document", label: "Document", color: "#6F87A6", accent: "#B9CBE5", kind: "document", text: "DOC" },
  { id: "markdown", label: "Markdown", color: "#5E8BD7", accent: "#C1D8FF", kind: "markdown", text: "MD" },
  { id: "html", label: "HTML", color: "#E86F42", accent: "#FFD0B8", kind: "code", text: "H" },
  { id: "css", label: "CSS", color: "#4C83E6", accent: "#BFD6FF", kind: "brackets", text: "#" },
  { id: "sass", label: "Sass", color: "#D866A4", accent: "#F8C7DF", kind: "brackets", text: "S" },
  { id: "javascript", label: "JavaScript", color: "#D6A72C", accent: "#FFE275", kind: "code", text: "JS" },
  { id: "typescript", label: "TypeScript", color: "#3E86D9", accent: "#B9D7FF", kind: "code", text: "TS" },
  { id: "react", label: "React", color: "#37A9CE", accent: "#B5F0FF", kind: "react" },
  { id: "vue", label: "Vue", color: "#45A978", accent: "#BCEFD6", kind: "code", text: "V" },
  { id: "svelte", label: "Svelte", color: "#E4663A", accent: "#FFD0BD", kind: "code", text: "S" },
  { id: "astro", label: "Astro", color: "#9A6CFF", accent: "#D8C8FF", kind: "palette", text: "A" },
  { id: "json", label: "JSON", color: "#D7A834", accent: "#FFE49B", kind: "brackets", text: "{}" },
  { id: "yaml", label: "YAML", color: "#D86B73", accent: "#FFC8CC", kind: "brackets", text: "Y" },
  { id: "toml", label: "TOML", color: "#9A7D61", accent: "#E4D2BF", kind: "gear" },
  { id: "xml", label: "XML", color: "#7B75D6", accent: "#D0CCFF", kind: "brackets", text: "<>" },
  { id: "rust", label: "Rust", color: "#CF7852", accent: "#F4C8B3", kind: "rust" },
  { id: "python", label: "Python", color: "#4C82B8", accent: "#FFD56F", kind: "python" },
  { id: "go", label: "Go", color: "#35A9C9", accent: "#B8F2FF", kind: "go" },
  { id: "java", label: "Java", color: "#C96E50", accent: "#FFD0BD", kind: "java" },
  { id: "c", label: "C", color: "#6B8DDB", accent: "#CCD9FF", kind: "code", text: "C" },
  { id: "cpp", label: "C++", color: "#5C78CF", accent: "#C6D2FF", kind: "code", text: "C+" },
  { id: "csharp", label: "C#", color: "#7D66C8", accent: "#D4C9FF", kind: "code", text: "C#" },
  { id: "swift", label: "Swift", color: "#E6734B", accent: "#FFD0BD", kind: "swift" },
  { id: "zig", label: "Zig", color: "#D49A38", accent: "#FFE0A3", kind: "zig" },
  { id: "ruby", label: "Ruby", color: "#CA5565", accent: "#FFC7D0", kind: "code", text: "RB" },
  { id: "php", label: "PHP", color: "#7572B9", accent: "#D1CFFF", kind: "code", text: "P" },
  { id: "shell", label: "Shell", color: "#52A371", accent: "#BFEBCF", kind: "terminal" },
  { id: "sql", label: "SQL", color: "#4F8FC9", accent: "#C6E0FF", kind: "database" },
  { id: "database", label: "Database", color: "#4F8FC9", accent: "#C6E0FF", kind: "database" },
  { id: "prisma", label: "Prisma", color: "#51758D", accent: "#C3D6E4", kind: "database", text: "P" },
  { id: "graphql", label: "GraphQL", color: "#D86AAE", accent: "#FFC7E7", kind: "brackets", text: "G" },
  { id: "docker", label: "Docker", color: "#3E94D9", accent: "#B9DEFF", kind: "docker" },
  { id: "git", label: "Git", color: "#DB7354", accent: "#FFD1C2", kind: "git" },
  { id: "github", label: "GitHub", color: "#667085", accent: "#D2D8E2", kind: "git" },
  { id: "package", label: "Package", color: "#C48940", accent: "#F6D4A8", kind: "package" },
  { id: "node", label: "Node", color: "#5FAE64", accent: "#C7F0CA", kind: "package", text: "N" },
  { id: "bun", label: "Bun", color: "#B38A67", accent: "#F1D6BE", kind: "package", text: "B" },
  { id: "deno", label: "Deno", color: "#6E7781", accent: "#D3DAE2", kind: "package", text: "D" },
  { id: "lock", label: "Lock", color: "#B38842", accent: "#F0D19A", kind: "lock" },
  { id: "config", label: "Config", color: "#78899A", accent: "#CCD7E2", kind: "gear" },
  { id: "env", label: "Environment", color: "#62A36D", accent: "#C9EBCF", kind: "lock" },
  { id: "test", label: "Test", color: "#75A94C", accent: "#D7EDBD", kind: "test" },
  { id: "vite", label: "Vite", color: "#9A73F3", accent: "#FFE47A", kind: "cloud", text: "V" },
  { id: "tailwind", label: "Tailwind", color: "#35A9C9", accent: "#B8F2FF", kind: "cloud", text: "T" },
  { id: "image", label: "Image", color: "#44A994", accent: "#BEEFE3", kind: "image" },
  { id: "svg", label: "SVG", color: "#D29438", accent: "#FFE0A3", kind: "palette", text: "S" },
  { id: "audio", label: "Audio", color: "#9B6ED6", accent: "#DCCAFF", kind: "audio" },
  { id: "video", label: "Video", color: "#D86B7F", accent: "#FFC8D2", kind: "video" },
  { id: "font", label: "Font", color: "#956FBB", accent: "#DEC9F7", kind: "font" },
  { id: "pdf", label: "PDF", color: "#D75959", accent: "#FFC8C8", kind: "document", text: "PDF" },
  { id: "notebook", label: "Notebook", color: "#D58D3A", accent: "#FFD9A3", kind: "book" },
];

fileIcons.push(
  { id: "next", label: "Next", color: "#657083", accent: "#D5DBE5", kind: "compass", text: "N" },
  { id: "nuxt", label: "Nuxt", color: "#45A978", accent: "#BCEFD6", kind: "layers", text: "N" },
  { id: "angular", label: "Angular", color: "#D85C65", accent: "#FFC9D0", kind: "angular" },
  { id: "solid", label: "Solid", color: "#4B84D8", accent: "#BED7FF", kind: "layers", text: "S" },
  { id: "remix", label: "Remix", color: "#5C6A78", accent: "#D2DAE3", kind: "compass", text: "R" },
  { id: "qwik", label: "Qwik", color: "#8A70D6", accent: "#D5CAFF", kind: "bolt", text: "Q" },
  { id: "lit", label: "Lit", color: "#D98A3C", accent: "#FFD9A8", kind: "flame" },
  { id: "storybook", label: "Storybook", color: "#D86AAE", accent: "#FFC7E7", kind: "book", text: "SB" },
  { id: "jest", label: "Jest", color: "#B65D7A", accent: "#F6C8D8", kind: "test" },
  { id: "vitest", label: "Vitest", color: "#7EA84B", accent: "#DCEEBE", kind: "test" },
  { id: "playwright", label: "Playwright", color: "#4B9363", accent: "#C3E8CD", kind: "test" },
  { id: "cypress", label: "Cypress", color: "#4B9B86", accent: "#BEEFE0", kind: "test" },
  { id: "eslint", label: "ESLint", color: "#766CD2", accent: "#D1CCFF", kind: "shield", text: "E" },
  { id: "prettier", label: "Prettier", color: "#B88A4C", accent: "#F2D4A6", kind: "pen" },
  { id: "biome", label: "Biome", color: "#78A955", accent: "#D9EDC4", kind: "leaf" },
  { id: "babel", label: "Babel", color: "#C9A43E", accent: "#FFE48A", kind: "brackets", text: "B" },
  { id: "swc", label: "SWC", color: "#DB8A3D", accent: "#FFD6A6", kind: "cube", text: "S" },
  { id: "webpack", label: "Webpack", color: "#4C91C7", accent: "#C4E2FA", kind: "cube", text: "W" },
  { id: "rollup", label: "Rollup", color: "#CA6656", accent: "#FFCABE", kind: "cube", text: "R" },
  { id: "rspack", label: "Rspack", color: "#6F7DD6", accent: "#CDD4FF", kind: "cube", text: "R" },
  { id: "turborepo", label: "Turborepo", color: "#B75A63", accent: "#F7C8CE", kind: "network", text: "T" },
  { id: "nx", label: "Nx", color: "#5C7186", accent: "#C8D5E2", kind: "network", text: "NX" },
  { id: "npm", label: "npm", color: "#C75858", accent: "#FFC8C8", kind: "package", text: "N" },
  { id: "pnpm", label: "pnpm", color: "#C9953E", accent: "#FFE0A3", kind: "package", text: "P" },
  { id: "yarn", label: "Yarn", color: "#4B91C7", accent: "#C4E2FA", kind: "package", text: "Y" },
  { id: "maven", label: "Maven", color: "#B65D8B", accent: "#F6C8E0", kind: "package", text: "M" },
  { id: "gradle", label: "Gradle", color: "#4B9B86", accent: "#BEEFE0", kind: "package", text: "G" },
  { id: "kotlin", label: "Kotlin", color: "#8B70D6", accent: "#D8CCFF", kind: "code", text: "K" },
  { id: "dart", label: "Dart", color: "#3F9AC6", accent: "#BDE8FA", kind: "code", text: "D" },
  { id: "lua", label: "Lua", color: "#5F72C8", accent: "#CAD3FF", kind: "code", text: "L" },
  { id: "elixir", label: "Elixir", color: "#8667B7", accent: "#D9C7F5", kind: "code", text: "EX" },
  { id: "erlang", label: "Erlang", color: "#B95773", accent: "#F7C7D4", kind: "code", text: "ER" },
  { id: "haskell", label: "Haskell", color: "#7667B7", accent: "#D1C7F5", kind: "code", text: "HS" },
  { id: "scala", label: "Scala", color: "#C95D58", accent: "#FFC9C7", kind: "layers", text: "S" },
  { id: "clojure", label: "Clojure", color: "#609D62", accent: "#CAEBCB", kind: "leaf" },
  { id: "nim", label: "Nim", color: "#C99A3C", accent: "#FFE1A2", kind: "code", text: "N" },
  { id: "nix", label: "Nix", color: "#5C90C6", accent: "#C5E1F9", kind: "network", text: "N" },
  { id: "terraform", label: "Terraform", color: "#826FD6", accent: "#D4CCFF", kind: "cube", text: "TF" },
  { id: "kubernetes", label: "Kubernetes", color: "#4F7EDB", accent: "#C4D5FF", kind: "network", text: "K8" },
  { id: "helm", label: "Helm", color: "#5B83C8", accent: "#C7DAFA", kind: "compass", text: "H" },
  { id: "ansible", label: "Ansible", color: "#697280", accent: "#D3DAE2", kind: "compass", text: "A" },
  { id: "cloudflare", label: "Cloudflare", color: "#D98A3C", accent: "#FFD9A8", kind: "cloud", text: "CF" },
  { id: "netlify", label: "Netlify", color: "#35A7A0", accent: "#B9F0EC", kind: "cloud", text: "N" },
  { id: "vercel", label: "Vercel", color: "#657083", accent: "#D5DBE5", kind: "cloud", text: "V" },
  { id: "firebase", label: "Firebase", color: "#D79A35", accent: "#FFE0A0", kind: "flame" },
  { id: "supabase", label: "Supabase", color: "#4BA46C", accent: "#C4EBCF", kind: "database", text: "S" },
  { id: "mongo", label: "Mongo", color: "#5FAE64", accent: "#C7F0CA", kind: "leaf" },
  { id: "redis", label: "Redis", color: "#C95D58", accent: "#FFC9C7", kind: "database", text: "R" },
  { id: "postgres", label: "Postgres", color: "#4F83C6", accent: "#C4DDF9", kind: "database", text: "P" },
  { id: "drizzle", label: "Drizzle", color: "#8BAF4D", accent: "#DEEFBE", kind: "database", text: "D" },
  { id: "figma", label: "Figma", color: "#9A73F3", accent: "#FFC0B5", kind: "layers", text: "F" },
  { id: "sketch", label: "Sketch", color: "#D99A3C", accent: "#FFE1A8", kind: "palette", text: "S" },
  { id: "adobe", label: "Adobe", color: "#D75B61", accent: "#FFC8CC", kind: "palette", text: "A" },
  { id: "csv", label: "CSV", color: "#59A471", accent: "#C7EBCF", kind: "graph", text: "CSV" },
  { id: "spreadsheet", label: "Spreadsheet", color: "#59A471", accent: "#C7EBCF", kind: "graph", text: "XLS" },
  { id: "word", label: "Word", color: "#4F83C6", accent: "#C4DDF9", kind: "document", text: "DOC" },
  { id: "powerpoint", label: "PowerPoint", color: "#C96E50", accent: "#FFD0BD", kind: "document", text: "PPT" },
  { id: "archive", label: "Archive", color: "#9A7D61", accent: "#E4D2BF", kind: "archive" },
  { id: "certificate", label: "Certificate", color: "#B38842", accent: "#F0D19A", kind: "shield", text: "CRT" },
  { id: "key", label: "Key", color: "#B38842", accent: "#F0D19A", kind: "key" },
  { id: "log", label: "Log", color: "#7D8CA1", accent: "#D1DAE5", kind: "document", text: "LOG" },
  { id: "diff", label: "Diff", color: "#7D8CA1", accent: "#D1DAE5", kind: "document", text: "+-" },
  { id: "patch", label: "Patch", color: "#7D8CA1", accent: "#D1DAE5", kind: "document", text: "+-" },
  { id: "license", label: "License", color: "#B38842", accent: "#F0D19A", kind: "shield", text: "LIC" },
  { id: "makefile", label: "Makefile", color: "#7D8CA1", accent: "#D1DAE5", kind: "gear" },
  { id: "cmake", label: "CMake", color: "#5C83C8", accent: "#C7DAFA", kind: "gear" },
  { id: "proto", label: "Proto", color: "#D78A3C", accent: "#FFD6A3", kind: "network", text: "P" },
  { id: "wasm", label: "Wasm", color: "#7B75D6", accent: "#D0CCFF", kind: "cube", text: "W" },
  { id: "rescript", label: "ReScript", color: "#C95D58", accent: "#FFC9C7", kind: "code", text: "RE" },
  { id: "ocaml", label: "OCaml", color: "#D98A3C", accent: "#FFD9A8", kind: "code", text: "ML" },
  { id: "solidity", label: "Solidity", color: "#697280", accent: "#D3DAE2", kind: "cube", text: "S" },
  { id: "r", label: "R", color: "#4F83C6", accent: "#C4DDF9", kind: "graph", text: "R" },
  { id: "julia", label: "Julia", color: "#8B70D6", accent: "#D8CCFF", kind: "graph", text: "JL" },
  { id: "perl", label: "Perl", color: "#657083", accent: "#D5DBE5", kind: "code", text: "PL" },
  { id: "athas", label: "Athas", color: "#4E91D9", accent: "#D7E8FF", kind: "bolt", text: "A" },
  { id: "codex", label: "Codex", color: "#657083", accent: "#D5DBE5", kind: "terminal", text: "CX" },
  { id: "claude", label: "Claude", color: "#B87C59", accent: "#F3D0BA", kind: "document", text: "AI" },
  { id: "cursor", label: "Cursor", color: "#657083", accent: "#D5DBE5", kind: "pen" },
  { id: "tauri", label: "Tauri", color: "#D49A38", accent: "#FFE0A3", kind: "mobile", text: "T" },
  { id: "electron", label: "Electron", color: "#37A9CE", accent: "#B5F0FF", kind: "network", text: "E" },
  { id: "xcode", label: "Xcode", color: "#4F83C6", accent: "#C4DDF9", kind: "mobile", text: "X" },
  { id: "android", label: "Android", color: "#7EA84B", accent: "#DCEEBE", kind: "mobile", text: "A" },
  { id: "apple", label: "Apple", color: "#7D8CA1", accent: "#D1DAE5", kind: "mobile", text: "iOS" },
  { id: "windows", label: "Windows", color: "#4F83C6", accent: "#C4DDF9", kind: "layers", text: "W" },
  { id: "linux", label: "Linux", color: "#C9953E", accent: "#FFE0A3", kind: "terminal", text: "LX" },
  { id: "changelog", label: "Changelog", color: "#5E8BD7", accent: "#C1D8FF", kind: "document", text: "LOG" },
  { id: "authors", label: "Authors", color: "#9A7D61", accent: "#E4D2BF", kind: "document", text: "BY" },
  { id: "security", label: "Security", color: "#B38842", accent: "#F0D19A", kind: "shield", text: "SEC" },
  { id: "warning", label: "Warning", color: "#D58D3A", accent: "#FFD9A3", kind: "warning" },
  { id: "agents", label: "Agents", color: "#657083", accent: "#D5DBE5", kind: "network", text: "AI" },
  { id: "copilot", label: "Copilot", color: "#4B9363", accent: "#C3E8CD", kind: "network", text: "AI" },
  { id: "gemini", label: "Gemini", color: "#5E8BD7", accent: "#C1D8FF", kind: "sparkles", text: "G" },
  { id: "cline", label: "Cline", color: "#7D66C8", accent: "#D4C9FF", kind: "terminal", text: "CL" },
  { id: "mcp", label: "MCP", color: "#35A7A0", accent: "#B9F0EC", kind: "network", text: "M" },
  { id: "editorconfig", label: "EditorConfig", color: "#7D8CA1", accent: "#D1DAE5", kind: "gear", text: "EC" },
  { id: "stylelint", label: "Stylelint", color: "#D866A4", accent: "#F8C7DF", kind: "shield", text: "SL" },
  { id: "markdownlint", label: "Markdownlint", color: "#5E8BD7", accent: "#C1D8FF", kind: "markdown", text: "ML" },
  { id: "cspell", label: "CSpell", color: "#4BA46C", accent: "#C4EBCF", kind: "book", text: "CS" },
  { id: "commitlint", label: "Commitlint", color: "#DB7354", accent: "#FFD1C2", kind: "git", text: "CL" },
  { id: "lintstaged", label: "Lint Staged", color: "#766CD2", accent: "#D1CCFF", kind: "shield", text: "LS" },
  { id: "renovate", label: "Renovate", color: "#4F83C6", accent: "#C4DDF9", kind: "gear", text: "R" },
  { id: "dependabot", label: "Dependabot", color: "#4B9363", accent: "#C3E8CD", kind: "package", text: "D" },
  { id: "docker-compose", label: "Docker Compose", color: "#3E94D9", accent: "#B9DEFF", kind: "docker", text: "DC" },
  { id: "devcontainer", label: "Dev Container", color: "#4F83C6", accent: "#C4DDF9", kind: "cube", text: "DC" },
  { id: "github-actions", label: "GitHub Actions", color: "#5E8BD7", accent: "#C1D8FF", kind: "bolt", text: "GH" },
  { id: "gitlab", label: "GitLab", color: "#D98A3C", accent: "#FFD9A8", kind: "git", text: "GL" },
  { id: "bitbucket", label: "Bitbucket", color: "#4F7EDB", accent: "#C4D5FF", kind: "git", text: "BB" },
  { id: "jenkins", label: "Jenkins", color: "#B95773", accent: "#F7C7D4", kind: "gear", text: "J" },
  { id: "vercel-config", label: "Vercel Config", color: "#657083", accent: "#D5DBE5", kind: "cloud", text: "VC" },
  { id: "nginx", label: "Nginx", color: "#4BA46C", accent: "#C4EBCF", kind: "network", text: "N" },
  { id: "http", label: "HTTP", color: "#4F83C6", accent: "#C4DDF9", kind: "network", text: "HT" },
  { id: "hurl", label: "Hurl", color: "#C95D58", accent: "#FFC9C7", kind: "network", text: "HU" },
  { id: "graphql-schema", label: "GraphQL Schema", color: "#D86AAE", accent: "#FFC7E7", kind: "brackets", text: "GS" },
  { id: "jsconfig", label: "JS Config", color: "#D6A72C", accent: "#FFE275", kind: "gear", text: "JS" },
  { id: "index-js", label: "Index JS", color: "#D6A72C", accent: "#FFE275", kind: "code", text: "IDX" },
  { id: "index-ts", label: "Index TS", color: "#3E86D9", accent: "#B9D7FF", kind: "code", text: "IDX" },
  { id: "layout", label: "Layout", color: "#5E8BD7", accent: "#C1D8FF", kind: "layers", text: "L" },
  { id: "page", label: "Page", color: "#5E8BD7", accent: "#C1D8FF", kind: "document", text: "P" },
  { id: "route", label: "Route", color: "#45A978", accent: "#BCEFD6", kind: "network", text: "RT" },
  { id: "loading", label: "Loading", color: "#8B70D6", accent: "#D8CCFF", kind: "compass", text: "..." },
  { id: "not-found", label: "Not Found", color: "#D58D3A", accent: "#FFD9A3", kind: "warning", text: "404" },
  { id: "error", label: "Error", color: "#C95D58", accent: "#FFC9C7", kind: "warning", text: "!" },
  { id: "docusaurus", label: "Docusaurus", color: "#4BA46C", accent: "#C4EBCF", kind: "book", text: "D" },
  { id: "gatsby", label: "Gatsby", color: "#8B70D6", accent: "#D8CCFF", kind: "compass", text: "G" },
  { id: "laravel", label: "Laravel", color: "#E4663A", accent: "#FFD0BD", kind: "flame", text: "L" },
  { id: "django", label: "Django", color: "#4B9363", accent: "#C3E8CD", kind: "leaf", text: "D" },
  { id: "flask", label: "Flask", color: "#657083", accent: "#D5DBE5", kind: "test", text: "F" },
  { id: "fastapi", label: "FastAPI", color: "#35A7A0", accent: "#B9F0EC", kind: "bolt", text: "FA" },
  { id: "arduino", label: "Arduino", color: "#35A7A0", accent: "#B9F0EC", kind: "network", text: "A" },
  { id: "blender", label: "Blender", color: "#D98A3C", accent: "#FFD9A8", kind: "cube", text: "B" },
  { id: "drawio", label: "Draw.io", color: "#D98A3C", accent: "#FFD9A8", kind: "graph", text: "D" },
  { id: "excalidraw", label: "Excalidraw", color: "#8B70D6", accent: "#D8CCFF", kind: "pen", text: "EX" },
  { id: "mermaid", label: "Mermaid", color: "#45A978", accent: "#BCEFD6", kind: "graph", text: "MM" },
);

const folderIcons: FolderIcon[] = [
  { id: "folder", label: "Folder", color: "#7F8EA3", accent: "#C5D0DE" },
  { id: "folder-open", label: "Folder Open", color: "#7F8EA3", accent: "#D3DCE8", mark: "open" },
  { id: "folder-src", label: "Source", color: "#4E91D9", accent: "#BBD9FF", mark: "src" },
  { id: "folder-components", label: "Components", color: "#47A7C7", accent: "#BBEDFA", mark: "grid" },
  { id: "folder-hooks", label: "Hooks", color: "#8B74D6", accent: "#D5CCFF", mark: "hook" },
  { id: "folder-utils", label: "Utilities", color: "#7D8CA1", accent: "#D1DAE5", mark: "tool" },
  { id: "folder-tests", label: "Tests", color: "#74A94D", accent: "#D5EDBE", mark: "check" },
  { id: "folder-config", label: "Config", color: "#8491A2", accent: "#D2DAE5", mark: "gear" },
  { id: "folder-assets", label: "Assets", color: "#44A994", accent: "#BEEFE3", mark: "image" },
  { id: "folder-images", label: "Images", color: "#44A994", accent: "#BEEFE3", mark: "image" },
  { id: "folder-docs", label: "Docs", color: "#5E8BD7", accent: "#C1D8FF", mark: "doc" },
  { id: "folder-scripts", label: "Scripts", color: "#52A371", accent: "#BFEBCF", mark: "term" },
  { id: "folder-rust", label: "Rust", color: "#CF7852", accent: "#F4C8B3", mark: "rs" },
  { id: "folder-tauri", label: "Tauri", color: "#D49A38", accent: "#FFE0A3", mark: "tau" },
  { id: "folder-node", label: "Node", color: "#5FAE64", accent: "#C7F0CA", mark: "pkg" },
  { id: "folder-git", label: "Git", color: "#DB7354", accent: "#FFD1C2", mark: "git" },
  { id: "folder-github", label: "GitHub", color: "#667085", accent: "#D2D8E2", mark: "git" },
  { id: "folder-vscode", label: "VS Code", color: "#4E91D9", accent: "#BBD9FF", mark: "code" },
  { id: "folder-build", label: "Build", color: "#C48940", accent: "#F6D4A8", mark: "box" },
  { id: "folder-dist", label: "Dist", color: "#9A7D61", accent: "#E4D2BF", mark: "box" },
  { id: "folder-database", label: "Database", color: "#4F8FC9", accent: "#C6E0FF", mark: "db" },
  { id: "folder-api", label: "API", color: "#D86AAE", accent: "#FFC7E7", mark: "api" },
  { id: "folder-routes", label: "Routes", color: "#45A978", accent: "#BCEFD6", mark: "route" },
  { id: "folder-stores", label: "Stores", color: "#9A73F3", accent: "#D8C8FF", mark: "store" },
  { id: "folder-features", label: "Features", color: "#E86F42", accent: "#FFD0B8", mark: "spark" },
];

folderIcons.push(
  { id: "folder-ui", label: "UI", color: "#9A73F3", accent: "#D8C8FF", mark: "grid" },
  { id: "folder-pages", label: "Pages", color: "#5E8BD7", accent: "#C1D8FF", mark: "doc" },
  { id: "folder-views", label: "Views", color: "#5E8BD7", accent: "#C1D8FF", mark: "doc" },
  { id: "folder-lib", label: "Library", color: "#7D8CA1", accent: "#D1DAE5", mark: "box" },
  { id: "folder-services", label: "Services", color: "#4B9B86", accent: "#BEEFE0", mark: "api" },
  { id: "folder-types", label: "Types", color: "#3E86D9", accent: "#B9D7FF", mark: "ts" },
  { id: "folder-styles", label: "Styles", color: "#D866A4", accent: "#F8C7DF", mark: "style" },
  { id: "folder-locales", label: "Locales", color: "#4BA46C", accent: "#C4EBCF", mark: "lang" },
  { id: "folder-terminal", label: "Terminal", color: "#52A371", accent: "#BFEBCF", mark: "term" },
  { id: "folder-security", label: "Security", color: "#B38842", accent: "#F0D19A", mark: "lock" },
  { id: "folder-ci", label: "CI", color: "#DB7354", accent: "#FFD1C2", mark: "check" },
  { id: "folder-docker", label: "Docker", color: "#3E94D9", accent: "#B9DEFF", mark: "box" },
  { id: "folder-kubernetes", label: "Kubernetes", color: "#4F7EDB", accent: "#C4D5FF", mark: "net" },
  { id: "folder-cloud", label: "Cloud", color: "#35A7A0", accent: "#B9F0EC", mark: "cloud" },
  { id: "folder-firebase", label: "Firebase", color: "#D79A35", accent: "#FFE0A0", mark: "spark" },
  { id: "folder-supabase", label: "Supabase", color: "#4BA46C", accent: "#C4EBCF", mark: "db" },
  { id: "folder-prisma", label: "Prisma", color: "#51758D", accent: "#C3D6E4", mark: "db" },
  { id: "folder-cache", label: "Cache", color: "#C95D58", accent: "#FFC9C7", mark: "db" },
  { id: "folder-logs", label: "Logs", color: "#7D8CA1", accent: "#D1DAE5", mark: "doc" },
  { id: "folder-temp", label: "Temp", color: "#9A7D61", accent: "#E4D2BF", mark: "box" },
  { id: "folder-mobile", label: "Mobile", color: "#45A978", accent: "#BCEFD6", mark: "mobile" },
  { id: "folder-ios", label: "iOS", color: "#7D8CA1", accent: "#D1DAE5", mark: "mobile" },
  { id: "folder-android", label: "Android", color: "#7EA84B", accent: "#DCEEBE", mark: "mobile" },
  { id: "folder-storybook", label: "Storybook", color: "#D86AAE", accent: "#FFC7E7", mark: "doc" },
  { id: "folder-fixtures", label: "Fixtures", color: "#74A94D", accent: "#D5EDBE", mark: "box" },
  { id: "folder-mocks", label: "Mocks", color: "#74A94D", accent: "#D5EDBE", mark: "spark" },
  { id: "folder-generated", label: "Generated", color: "#9A7D61", accent: "#E4D2BF", mark: "spark" },
  { id: "folder-benchmarks", label: "Benchmarks", color: "#D58D3A", accent: "#FFD9A3", mark: "graph" },
  { id: "folder-extensions", label: "Extensions", color: "#8B74D6", accent: "#D5CCFF", mark: "puzzle" },
  { id: "folder-themes", label: "Themes", color: "#956FBB", accent: "#DEC9F7", mark: "style" },
  { id: "folder-ai", label: "AI", color: "#657083", accent: "#D5DBE5", mark: "ai" },
  { id: "folder-agents", label: "Agents", color: "#657083", accent: "#D5DBE5", mark: "ai" },
  { id: "folder-codex", label: "Codex", color: "#657083", accent: "#D5DBE5", mark: "cx" },
  { id: "folder-claude", label: "Claude", color: "#B87C59", accent: "#F3D0BA", mark: "ai" },
  { id: "folder-packages", label: "Packages", color: "#C48940", accent: "#F6D4A8", mark: "pkg" },
  { id: "folder-examples", label: "Examples", color: "#45A978", accent: "#BCEFD6", mark: "spark" },
  { id: "folder-playground", label: "Playground", color: "#8B74D6", accent: "#D5CCFF", mark: "spark" },
  { id: "folder-commands", label: "Commands", color: "#52A371", accent: "#BFEBCF", mark: "term" },
  { id: "folder-plugins", label: "Plugins", color: "#8B74D6", accent: "#D5CCFF", mark: "puzzle" },
  { id: "folder-workflows", label: "Workflows", color: "#5E8BD7", accent: "#C1D8FF", mark: "check" },
  { id: "folder-devcontainer", label: "Dev Container", color: "#4F83C6", accent: "#C4DDF9", mark: "box" },
  { id: "folder-web", label: "Web", color: "#35A7A0", accent: "#B9F0EC", mark: "net" },
  { id: "folder-server", label: "Server", color: "#4F8FC9", accent: "#C6E0FF", mark: "db" },
  { id: "folder-client", label: "Client", color: "#47A7C7", accent: "#BBEDFA", mark: "grid" },
  { id: "folder-shared", label: "Shared", color: "#7D8CA1", accent: "#D1DAE5", mark: "link" },
);

const fileExtensions: Record<string, string> = {
  ".txt": "text",
  ".md": "markdown",
  ".mdx": "markdown",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "sass",
  ".sass": "sass",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "react",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "react",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".svg": "svg",
  ".rs": "rust",
  ".ron": "rust",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".zig": "zig",
  ".rb": "ruby",
  ".php": "php",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".sql": "sql",
  ".sqlite": "database",
  ".sqlite3": "database",
  ".db": "database",
  ".prisma": "prisma",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".dockerfile": "docker",
  ".lock": "lock",
  ".env": "env",
  ".test.js": "test",
  ".test.ts": "test",
  ".test.tsx": "test",
  ".spec.js": "test",
  ".spec.ts": "test",
  ".spec.tsx": "test",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".ico": "image",
  ".mp3": "audio",
  ".wav": "audio",
  ".flac": "audio",
  ".mp4": "video",
  ".mov": "video",
  ".webm": "video",
  ".ttf": "font",
  ".otf": "font",
  ".woff": "font",
  ".woff2": "font",
  ".pdf": "pdf",
  ".ipynb": "notebook",
};

Object.assign(fileExtensions, {
  ".vue.ts": "vue",
  ".svelte.ts": "svelte",
  ".stories.js": "storybook",
  ".stories.jsx": "storybook",
  ".stories.ts": "storybook",
  ".stories.tsx": "storybook",
  ".story.js": "storybook",
  ".story.jsx": "storybook",
  ".story.ts": "storybook",
  ".story.tsx": "storybook",
  ".cy.js": "cypress",
  ".cy.ts": "cypress",
  ".cy.tsx": "cypress",
  ".playwright.js": "playwright",
  ".playwright.ts": "playwright",
  ".test.mjs": "test",
  ".spec.mjs": "test",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".dart": "dart",
  ".lua": "lua",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".scala": "scala",
  ".sc": "scala",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".nim": "nim",
  ".nix": "nix",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".hcl": "terraform",
  ".k8s.yaml": "kubernetes",
  ".helm.yaml": "helm",
  ".yarnrc": "yarn",
  ".npmrc": "npm",
  ".csv": "csv",
  ".tsv": "csv",
  ".xlsx": "spreadsheet",
  ".xls": "spreadsheet",
  ".doc": "word",
  ".docx": "word",
  ".ppt": "powerpoint",
  ".pptx": "powerpoint",
  ".zip": "archive",
  ".tar": "archive",
  ".gz": "archive",
  ".tgz": "archive",
  ".rar": "archive",
  ".7z": "archive",
  ".pem": "certificate",
  ".crt": "certificate",
  ".cer": "certificate",
  ".key": "key",
  ".log": "log",
  ".diff": "diff",
  ".patch": "patch",
  ".proto": "proto",
  ".wasm": "wasm",
  ".res": "rescript",
  ".resi": "rescript",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".sol": "solidity",
  ".r": "r",
  ".rmd": "r",
  ".jl": "julia",
  ".pl": "perl",
  ".app": "apple",
  ".ipa": "apple",
  ".apk": "android",
  ".aab": "android",
  ".exe": "windows",
  ".msi": "windows",
  ".dll": "windows",
  ".so": "linux",
  ".http": "http",
  ".rest": "http",
  ".hurl": "hurl",
  ".drawio": "drawio",
  ".excalidraw": "excalidraw",
  ".mmd": "mermaid",
  ".mermaid": "mermaid",
  ".blend": "blender",
  ".ino": "arduino",
});

const filenames: Record<string, string> = {
  "package.json": "node",
  "package-lock.json": "node",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "bunfig.toml": "bun",
  "deno.json": "deno",
  "deno.jsonc": "deno",
  "tsconfig.json": "typescript",
  "vite.config.js": "vite",
  "vite.config.ts": "vite",
  "tailwind.config.js": "tailwind",
  "tailwind.config.ts": "tailwind",
  "dockerfile": "docker",
  ".dockerignore": "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".env": "env",
  ".env.example": "env",
  "cargo.toml": "rust",
  "cargo.lock": "rust",
  "readme.md": "markdown",
  "license": "lock",
  "license.md": "lock",
};

Object.assign(filenames, {
  "next.config.js": "next",
  "next.config.mjs": "next",
  "next.config.ts": "next",
  "nuxt.config.js": "nuxt",
  "nuxt.config.ts": "nuxt",
  "angular.json": "angular",
  "remix.config.js": "remix",
  "remix.config.ts": "remix",
  "qwik.config.js": "qwik",
  "qwik.config.ts": "qwik",
  "lit.config.js": "lit",
  "storybook.config.js": "storybook",
  "jest.config.js": "jest",
  "jest.config.ts": "jest",
  "vitest.config.js": "vitest",
  "vitest.config.ts": "vitest",
  "playwright.config.js": "playwright",
  "playwright.config.ts": "playwright",
  "cypress.config.js": "cypress",
  "cypress.config.ts": "cypress",
  ".eslintrc": "eslint",
  ".eslintrc.json": "eslint",
  "eslint.config.js": "eslint",
  "eslint.config.mjs": "eslint",
  "eslint.config.ts": "eslint",
  ".prettierrc": "prettier",
  ".prettierrc.json": "prettier",
  "prettier.config.js": "prettier",
  "biome.json": "biome",
  "biome.jsonc": "biome",
  "babel.config.js": "babel",
  ".babelrc": "babel",
  ".swcrc": "swc",
  "webpack.config.js": "webpack",
  "webpack.config.ts": "webpack",
  "rollup.config.js": "rollup",
  "rollup.config.ts": "rollup",
  "rspack.config.js": "rspack",
  "rspack.config.ts": "rspack",
  "turbo.json": "turborepo",
  "nx.json": "nx",
  "pnpm-lock.yaml": "pnpm",
  "pnpm-workspace.yaml": "pnpm",
  "yarn.lock": "yarn",
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  "gradle.properties": "gradle",
  "gradlew": "gradle",
  "flake.nix": "nix",
  "terraform.tfvars": "terraform",
  "chart.yaml": "helm",
  "ansible.cfg": "ansible",
  "wrangler.toml": "cloudflare",
  "netlify.toml": "netlify",
  "vercel.json": "vercel",
  "firebase.json": "firebase",
  "supabase.toml": "supabase",
  "drizzle.config.ts": "drizzle",
  ".fig": "figma",
  "makefile": "makefile",
  "cmakelists.txt": "cmake",
  "license": "license",
  "license.md": "license",
  "copying": "license",
  "athas.json": "athas",
  ".codex": "codex",
  "agents.md": "codex",
  "claude.md": "claude",
  ".cursorrules": "cursor",
  "tauri.conf.json": "tauri",
  "electron-builder.json": "electron",
  "xcodeproj": "xcode",
  "androidmanifest.xml": "android",
  "changelog.md": "changelog",
  "authors": "authors",
  "authors.md": "authors",
  "security.md": "security",
  "codeowners": "security",
  ".agents": "agents",
  "agents.json": "agents",
  "agents.toml": "agents",
  "copilot-instructions.md": "copilot",
  ".mcp.json": "mcp",
  "mcp.json": "mcp",
  ".editorconfig": "editorconfig",
  ".stylelintrc": "stylelint",
  ".stylelintrc.json": "stylelint",
  "stylelint.config.js": "stylelint",
  "stylelint.config.mjs": "stylelint",
  ".markdownlint.json": "markdownlint",
  ".markdownlint.yaml": "markdownlint",
  ".markdownlintignore": "markdownlint",
  "cspell.json": "cspell",
  ".cspell.json": "cspell",
  "commitlint.config.js": "commitlint",
  "commitlint.config.ts": "commitlint",
  ".lintstagedrc": "lintstaged",
  "lint-staged.config.js": "lintstaged",
  "renovate.json": "renovate",
  "dependabot.yml": "dependabot",
  "docker-compose.yml": "docker-compose",
  "docker-compose.yaml": "docker-compose",
  ".devcontainer.json": "devcontainer",
  "devcontainer.json": "devcontainer",
  "action.yml": "github-actions",
  "action.yaml": "github-actions",
  ".gitlab-ci.yml": "gitlab",
  "bitbucket-pipelines.yml": "bitbucket",
  "jenkinsfile": "jenkins",
  "nginx.conf": "nginx",
  "index.js": "index-js",
  "index.ts": "index-ts",
  "index.tsx": "index-ts",
  "layout.js": "layout",
  "layout.jsx": "layout",
  "layout.ts": "layout",
  "layout.tsx": "layout",
  "page.js": "page",
  "page.jsx": "page",
  "page.ts": "page",
  "page.tsx": "page",
  "route.js": "route",
  "route.ts": "route",
  "loading.js": "loading",
  "loading.tsx": "loading",
  "not-found.js": "not-found",
  "not-found.tsx": "not-found",
  "error.js": "error",
  "error.tsx": "error",
  "docusaurus.config.js": "docusaurus",
  "docusaurus.config.ts": "docusaurus",
  "gatsby-config.js": "gatsby",
  "gatsby-node.js": "gatsby",
  "artisan": "laravel",
  "manage.py": "django",
  "app.py": "flask",
  "main.py": "python",
  "requirements.txt": "python",
});

const folders: Record<string, string> = {
  src: "folder-src",
  source: "folder-src",
  components: "folder-components",
  component: "folder-components",
  hooks: "folder-hooks",
  utils: "folder-utils",
  util: "folder-utils",
  tests: "folder-tests",
  test: "folder-tests",
  __tests__: "folder-tests",
  config: "folder-config",
  configs: "folder-config",
  assets: "folder-assets",
  public: "folder-assets",
  images: "folder-images",
  img: "folder-images",
  docs: "folder-docs",
  scripts: "folder-scripts",
  crates: "folder-rust",
  rust: "folder-rust",
  "src-tauri": "folder-tauri",
  tauri: "folder-tauri",
  node_modules: "folder-node",
  ".git": "folder-git",
  ".github": "folder-github",
  ".vscode": "folder-vscode",
  build: "folder-build",
  dist: "folder-dist",
  database: "folder-database",
  databases: "folder-database",
  api: "folder-api",
  routes: "folder-routes",
  router: "folder-routes",
  stores: "folder-stores",
  store: "folder-stores",
  features: "folder-features",
};

Object.assign(folders, {
  ui: "folder-ui",
  pages: "folder-pages",
  app: "folder-pages",
  views: "folder-views",
  view: "folder-views",
  lib: "folder-lib",
  libs: "folder-lib",
  services: "folder-services",
  service: "folder-services",
  types: "folder-types",
  typings: "folder-types",
  styles: "folder-styles",
  style: "folder-styles",
  css: "folder-styles",
  locales: "folder-locales",
  i18n: "folder-locales",
  terminal: "folder-terminal",
  shell: "folder-terminal",
  auth: "folder-security",
  security: "folder-security",
  ".circleci": "folder-ci",
  ".buildkite": "folder-ci",
  ".docker": "folder-docker",
  docker: "folder-docker",
  k8s: "folder-kubernetes",
  kubernetes: "folder-kubernetes",
  helm: "folder-kubernetes",
  cloud: "folder-cloud",
  ".firebase": "folder-firebase",
  firebase: "folder-firebase",
  ".supabase": "folder-supabase",
  supabase: "folder-supabase",
  prisma: "folder-prisma",
  cache: "folder-cache",
  logs: "folder-logs",
  log: "folder-logs",
  tmp: "folder-temp",
  temp: "folder-temp",
  mobile: "folder-mobile",
  ios: "folder-ios",
  android: "folder-android",
  ".storybook": "folder-storybook",
  storybook: "folder-storybook",
  fixtures: "folder-fixtures",
  mocks: "folder-mocks",
  mock: "folder-mocks",
  generated: "folder-generated",
  gen: "folder-generated",
  benchmark: "folder-benchmarks",
  benchmarks: "folder-benchmarks",
  extensions: "folder-extensions",
  extension: "folder-extensions",
  themes: "folder-themes",
  theme: "folder-themes",
  ai: "folder-ai",
  ".agents": "folder-agents",
  agents: "folder-agents",
  ".codex": "folder-codex",
  codex: "folder-codex",
  ".claude": "folder-claude",
  claude: "folder-claude",
  packages: "folder-packages",
  package: "folder-packages",
  examples: "folder-examples",
  example: "folder-examples",
  playground: "folder-playground",
  play: "folder-playground",
  commands: "folder-commands",
  command: "folder-commands",
  plugins: "folder-plugins",
  plugin: "folder-plugins",
  workflows: "folder-workflows",
  workflow: "folder-workflows",
  ".devcontainer": "folder-devcontainer",
  devcontainer: "folder-devcontainer",
  web: "folder-web",
  www: "folder-web",
  server: "folder-server",
  client: "folder-client",
  shared: "folder-shared",
  common: "folder-shared",
});

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function clampRgb(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: ReturnType<typeof hexToRgb>) {
  return `#${[r, g, b].map((value) => clampRgb(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function mixColor(from: string, to: string, amount: number) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);

  return rgbToHex({
    r: start.r + (end.r - start.r) * amount,
    g: start.g + (end.g - start.g) * amount,
    b: start.b + (end.b - start.b) * amount,
  });
}

const themeVariants: ThemeVariant[] = [
  {
    id: "athas-icons",
    name: "Athas (Dark)",
    description: "Original duotone file and folder icons for dark Athas themes.",
    directory: "",
    background: "#11151B",
    transform: (icon) => icon,
  },
  {
    id: "athas-icons-dimmed",
    name: "Athas (Dimmed)",
    description: "A softer, lower-saturation Athas icon palette for dimmed themes.",
    directory: "dimmed",
    background: "#151A22",
    transform: (icon) => ({
      color: mixColor(icon.color, "#7F8A9A", 0.34),
      accent: mixColor(icon.accent, "#B7C1CF", 0.34),
    }),
  },
  {
    id: "athas-icons-light",
    name: "Athas (Light)",
    description: "A brighter Athas icon palette tuned for light themes.",
    directory: "light",
    background: "#F6F8FB",
    transform: (icon) => ({
      color: mixColor(icon.color, "#FFFFFF", 0.16),
      accent: mixColor(icon.accent, "#243044", 0.14),
    }),
  },
];

function fileGlyph(icon: FileIcon) {
  const text = icon.text ? esc(icon.text) : "";

  switch (icon.kind) {
    case "code":
      return `<path d="M8.5 14.5 5.7 12l2.8-2.5" fill="none" stroke="${icon.accent}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="m15.5 9.5 2.8 2.5-2.8 2.5" fill="none" stroke="${icon.accent}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="18.1" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.6" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "brackets":
      return `<path d="M8.3 7.4H6.7c-.7 0-1.1.4-1.1 1.1v7c0 .7.4 1.1 1.1 1.1h1.6" fill="none" stroke="${icon.accent}" stroke-width="1.5" stroke-linecap="round"/><path d="M15.7 7.4h1.6c.7 0 1.1.4 1.1 1.1v7c0 .7-.4 1.1-1.1 1.1h-1.6" fill="none" stroke="${icon.accent}" stroke-width="1.5" stroke-linecap="round"/><text x="12" y="13.8" text-anchor="middle" font-family="Arial,sans-serif" font-size="5" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "react":
      return `<circle cx="12" cy="12" r="1.5" fill="${icon.accent}"/><ellipse cx="12" cy="12" rx="6.5" ry="2.5" fill="none" stroke="${icon.accent}" stroke-width="1.25"/><ellipse cx="12" cy="12" rx="6.5" ry="2.5" fill="none" stroke="${icon.accent}" stroke-width="1.25" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="6.5" ry="2.5" fill="none" stroke="${icon.accent}" stroke-width="1.25" transform="rotate(120 12 12)"/>`;
    case "database":
      return `<ellipse cx="12" cy="8" rx="5.2" ry="2.1" fill="${icon.accent}"/><path d="M6.8 8v6.8c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V8" fill="none" stroke="${icon.accent}" stroke-width="1.45"/><path d="M6.8 11.4c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2" fill="none" stroke="${icon.color}" stroke-width="1.2" opacity=".65"/>`;
    case "gear":
      return `<circle cx="12" cy="12" r="2.4" fill="none" stroke="${icon.accent}" stroke-width="1.55"/><path d="M12 6.2v1.5M12 16.3v1.5M6.2 12h1.5M16.3 12h1.5M7.9 7.9 9 9M15 15l1.1 1.1M16.1 7.9 15 9M9 15l-1.1 1.1" stroke="${icon.accent}" stroke-width="1.55" stroke-linecap="round"/>`;
    case "package":
      return `<path d="m12 6.4 5 2.6v6l-5 2.6-5-2.6V9z" fill="none" stroke="${icon.accent}" stroke-width="1.45" stroke-linejoin="round"/><path d="M7 9l5 2.6L17 9M12 11.6v6" stroke="${icon.accent}" stroke-width="1.25" stroke-linecap="round"/><text x="12" y="14.2" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.5" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "terminal":
      return `<path d="m7 9 3 3-3 3" fill="none" stroke="${icon.accent}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.2 15h4.2" stroke="${icon.accent}" stroke-width="1.7" stroke-linecap="round"/>`;
    case "image":
      return `<rect x="6.3" y="7.2" width="11.4" height="9.6" rx="1.7" fill="none" stroke="${icon.accent}" stroke-width="1.45"/><circle cx="9.8" cy="10.1" r="1.1" fill="${icon.accent}"/><path d="m7.7 15 3-3.1 2.2 2.1 1.4-1.4 2.1 2.4" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "document":
      return `<path d="M7.5 9h9M7.5 12h9M7.5 15h5.4" stroke="${icon.accent}" stroke-width="1.5" stroke-linecap="round"/><text x="12" y="18.3" text-anchor="middle" font-family="Arial,sans-serif" font-size="4" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "markdown":
      return `<path d="M6.2 15.5v-7h2l2.1 2.9 2.1-2.9h2v7h-1.8v-4.2l-2.3 2.9-2.3-2.9v4.2z" fill="${icon.accent}"/><path d="M15.6 8.5h2.2v3.7h1.5l-2.6 3.3-2.6-3.3h1.5z" fill="${icon.accent}"/>`;
    case "lock":
      return `<rect x="7" y="10.5" width="10" height="6.7" rx="1.7" fill="${icon.accent}"/><path d="M9.2 10.5V8.7a2.8 2.8 0 0 1 5.6 0v1.8" fill="none" stroke="${icon.accent}" stroke-width="1.45"/><circle cx="12" cy="13.8" r=".8" fill="${icon.color}"/>`;
    case "test":
      return `<path d="M9.2 6.8h5.6M10 6.8v3.9l-3.3 5.6c-.5.8.1 1.7 1 1.7h8.6c.9 0 1.5-.9 1-1.7L14 10.7V6.8" fill="none" stroke="${icon.accent}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.7 15.2h6.6" stroke="${icon.accent}" stroke-width="1.3" stroke-linecap="round"/>`;
    case "cloud":
      return `<path d="M8.2 15.8h7.6a3 3 0 0 0 .4-6 4.4 4.4 0 0 0-8.3 1.1 2.5 2.5 0 0 0 .3 4.9z" fill="none" stroke="${icon.accent}" stroke-width="1.45" stroke-linejoin="round"/><text x="12" y="14" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.5" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "git":
      return `<path d="m12 6 6 6-6 6-6-6z" fill="none" stroke="${icon.accent}" stroke-width="1.45" stroke-linejoin="round"/><path d="M10 10.1h2.6c1.1 0 2 .9 2 2v2.1M10 10.1V8.4M10 10.1v5.5" stroke="${icon.accent}" stroke-width="1.35" stroke-linecap="round"/><circle cx="10" cy="10.1" r="1" fill="${icon.accent}"/><circle cx="14.6" cy="14.2" r="1" fill="${icon.accent}"/>`;
    case "docker":
      return `<path d="M6.1 12.1h10.7c.9 0 1.5.7 1.2 1.6-.6 1.9-2.4 3.4-5.5 3.4H9.6c-2.1 0-3.5-1.3-3.5-3.1z" fill="${icon.accent}"/><path d="M8 9h2v2H8zM10.7 9h2v2h-2zM13.4 9h2v2h-2zM10.7 6.5h2v2h-2z" fill="${icon.color}"/>`;
    case "palette":
      return `<path d="M12 6.2a5.9 5.9 0 0 0 0 11.8h1.2c.9 0 1.3-1.1.6-1.7-.6-.5-.2-1.5.6-1.5h1.1c1.5 0 2.5-1.1 2.5-2.8a5.9 5.9 0 0 0-6-5.8z" fill="none" stroke="${icon.accent}" stroke-width="1.4"/><circle cx="9.4" cy="11" r=".8" fill="${icon.accent}"/><circle cx="12" cy="9.5" r=".8" fill="${icon.accent}"/><circle cx="14.7" cy="11" r=".8" fill="${icon.accent}"/><text x="12" y="16.2" text-anchor="middle" font-family="Arial,sans-serif" font-size="4" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "book":
      return `<path d="M7.3 6.8h7.3c1.1 0 2 .9 2 2v8.4H9.3a2 2 0 0 1-2-2z" fill="none" stroke="${icon.accent}" stroke-width="1.45"/><path d="M9.3 6.8v10.4M10.8 10h3.8M10.8 12.7h3.8" stroke="${icon.accent}" stroke-width="1.25" stroke-linecap="round"/>`;
    case "audio":
      return `<path d="M7.3 13.9h2.3l4.3 3.1V7l-4.3 3.1H7.3z" fill="${icon.accent}"/><path d="M16 10.2c.9 1 .9 2.6 0 3.6M17.8 8.6c1.8 1.9 1.8 4.9 0 6.8" fill="none" stroke="${icon.accent}" stroke-width="1.3" stroke-linecap="round"/>`;
    case "video":
      return `<rect x="6.2" y="8" width="9.1" height="8" rx="1.5" fill="none" stroke="${icon.accent}" stroke-width="1.45"/><path d="m15.3 10.6 3-1.8v6.4l-3-1.8z" fill="${icon.accent}"/>`;
    case "font":
      return `<path d="M7 17h2l.9-2.6h4.2L15 17h2L13.2 7H10.8zM10.5 12.7 12 8.6l1.5 4.1z" fill="${icon.accent}"/>`;
    case "rust":
      return `<circle cx="12" cy="12" r="5.1" fill="none" stroke="${icon.accent}" stroke-width="1.45"/><path d="M9.4 15.2V8.8H13c1.4 0 2.3.8 2.3 2 0 .9-.5 1.5-1.3 1.8l1.7 2.6h-2.1L12.2 13h-1v2.2zM11.2 11.5h1.5c.5 0 .8-.3.8-.7s-.3-.7-.8-.7h-1.5z" fill="${icon.accent}"/>`;
    case "python":
      return `<path d="M8.2 11.7V8.6c0-1.2 1-2.1 2.2-2.1h3.4c1.1 0 2 .9 2 2v2.3h-4.5c-.8 0-1.4.6-1.4 1.4v1.1H6.6c-.8 0-1.4-.6-1.4-1.4v-.2z" fill="${icon.accent}"/><path d="M15.8 12.3v3.1c0 1.2-1 2.1-2.2 2.1h-3.4c-1.1 0-2-.9-2-2v-2.3h4.5c.8 0 1.4-.6 1.4-1.4v-1.1h3.3c.8 0 1.4.6 1.4 1.4v.2z" fill="${icon.color}"/>`;
    case "go":
      return `<path d="M5.8 10h6.4M4.8 12.2h6.4M6.5 14.4h4.9" stroke="${icon.accent}" stroke-width="1.4" stroke-linecap="round"/><path d="M13.8 15.7c-2 0-3.1-1.3-2.8-3.1.3-2 2-4.3 4.6-4.3 1.9 0 3 1.2 2.8 3-.3 2.2-1.9 4.4-4.6 4.4z" fill="none" stroke="${icon.accent}" stroke-width="1.4"/><path d="M14.2 12.1h4" stroke="${icon.accent}" stroke-width="1.3" stroke-linecap="round"/>`;
    case "java":
      return `<path d="M10.4 14.8c-2.2.2-3.6.7-3.6 1.3 0 .8 2.3 1.4 5.2 1.4s5.2-.6 5.2-1.4c0-.6-1.4-1.1-3.6-1.3" fill="none" stroke="${icon.accent}" stroke-width="1.25"/><path d="M11.5 6.8c1.8 1.4-1.8 2.4.1 4M14 6.4c2.1 1.8-2.3 3 .1 5" fill="none" stroke="${icon.accent}" stroke-width="1.45" stroke-linecap="round"/>`;
    case "swift":
      return `<path d="M6.8 7.2c3.7 3.9 6.4 5.8 8.3 6.3-1.4.4-3 .3-4.8-.3 1.5 1.4 3.5 2.3 6.1 2.5 1-.9 1.4-2 1.3-3.3-.1-1.6-1.2-3.5-3.5-5.5 1.2 2 .8 3.7-.7 5.1-1.4-1.2-3.6-2.8-6.7-4.8z" fill="${icon.accent}"/>`;
    case "zig":
      return `<path d="M7.2 7.4h9.6l-4.1 4.1h4.1l-5.6 5.1 1.6-3.5H7.2l4.1-4.1H7.2z" fill="${icon.accent}"/>`;
    case "angular":
      return `<path d="m12 6.4 5.6 2-1 7.4-4.6 2.4-4.6-2.4-1-7.4z" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linejoin="round"/><path d="m9.3 15.4 2.7-7.1 2.7 7.1M10.4 12.7h3.2" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "archive":
      return `<path d="M7.3 7.2h9.4v10H7.3z" fill="none" stroke="${icon.accent}" stroke-width="1.45" stroke-linejoin="round"/><path d="M7.3 9.8h9.4M11 7.2v2.6M13 7.2v2.6M10.4 13.2h3.2v2h-3.2z" fill="none" stroke="${icon.accent}" stroke-width="1.2" stroke-linejoin="round"/>`;
    case "bolt":
      return `<path d="m13.2 6.5-6 6.9h4l-1.1 4.1 6.7-7.7h-4.1z" fill="${icon.accent}"/><text x="13.7" y="17.6" text-anchor="middle" font-family="Arial,sans-serif" font-size="4" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "compass":
      return `<circle cx="12" cy="12" r="5.7" fill="none" stroke="${icon.accent}" stroke-width="1.35"/><path d="m14.7 9.3-1.4 4-4 1.4 1.4-4z" fill="${icon.accent}"/><text x="12" y="18.1" text-anchor="middle" font-family="Arial,sans-serif" font-size="3.8" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "cube":
      return `<path d="m12 6.5 5 2.7v5.6l-5 2.7-5-2.7V9.2z" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linejoin="round"/><path d="M7 9.2 12 12l5-2.8M12 12v5.5" fill="none" stroke="${icon.accent}" stroke-width="1.15" stroke-linecap="round"/><text x="12" y="14.3" text-anchor="middle" font-family="Arial,sans-serif" font-size="3.9" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "flame":
      return `<path d="M12.7 6.3c.5 2.2 3.8 3.7 3.8 7a4.5 4.5 0 0 1-9 0c0-2.2 1.5-3.7 3.2-5.6-.1 1.7.5 2.6 1.4 3.4.7-1.4.8-2.8.6-4.8z" fill="${icon.accent}"/>`;
    case "graph":
      return `<path d="M7.1 16.8h9.8M8.2 16.3v-4.1M12 16.3V8M15.8 16.3v-6" stroke="${icon.accent}" stroke-width="1.45" stroke-linecap="round"/><text x="12" y="7.4" text-anchor="middle" font-family="Arial,sans-serif" font-size="3.8" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "key":
      return `<circle cx="9.7" cy="12" r="2.5" fill="none" stroke="${icon.accent}" stroke-width="1.45"/><path d="M12.2 12h5.1M15.2 12v2M17.3 12v1.4" fill="none" stroke="${icon.accent}" stroke-width="1.45" stroke-linecap="round"/>`;
    case "layers":
      return `<path d="m12 6.3 5.7 3-5.7 3-5.7-3zM6.3 12l5.7 3 5.7-3M6.3 14.8l5.7 3 5.7-3" fill="none" stroke="${icon.accent}" stroke-width="1.25" stroke-linejoin="round"/><text x="12" y="13.7" text-anchor="middle" font-family="Arial,sans-serif" font-size="3.8" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "leaf":
      return `<path d="M17.5 7c-5.6.1-8.7 2.4-9.5 6.9-.3 1.9 1.1 3.6 3.1 3.3 4.3-.7 6.3-4.2 6.4-10.2z" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linejoin="round"/><path d="M8.5 16.3c2.3-2.8 4.2-4.4 7.4-6.4" stroke="${icon.accent}" stroke-width="1.2" stroke-linecap="round"/>`;
    case "mobile":
      return `<rect x="8.7" y="6.3" width="6.6" height="11.4" rx="1.4" fill="none" stroke="${icon.accent}" stroke-width="1.4"/><path d="M10.9 8h2.2M11.4 15.8h1.2" stroke="${icon.accent}" stroke-width="1.2" stroke-linecap="round"/>`;
    case "network":
      return `<circle cx="8.2" cy="9" r="1.6" fill="${icon.accent}"/><circle cx="15.8" cy="9" r="1.6" fill="${icon.accent}"/><circle cx="12" cy="16" r="1.6" fill="${icon.accent}"/><path d="M9.5 10.2 11 14.5M14.5 10.2 13 14.5M9.8 9h4.4" stroke="${icon.accent}" stroke-width="1.15" stroke-linecap="round"/><text x="12" y="13.1" text-anchor="middle" font-family="Arial,sans-serif" font-size="3.5" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "pen":
      return `<path d="m8 15.8.8-3.2 5.9-5.9 2.4 2.4-5.9 5.9zM13.8 7.6l2.4 2.4" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.4 17h8.8" stroke="${icon.accent}" stroke-width="1.3" stroke-linecap="round"/>`;
    case "sparkles":
      return `<path d="M12 6.4 13.2 10l3.6 1.2-3.6 1.2L12 16l-1.2-3.6-3.6-1.2 3.6-1.2z" fill="${icon.accent}"/><path d="M17.1 6.8 17.7 8.4l1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6zM7.2 14.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="${icon.accent}" opacity=".82"/><text x="12" y="18.3" text-anchor="middle" font-family="Arial,sans-serif" font-size="3.6" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "shield":
      return `<path d="M12 6.3 17 8v3.5c0 3.2-2 5.3-5 6.4-3-1.1-5-3.2-5-6.4V8z" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linejoin="round"/><text x="12" y="13.7" text-anchor="middle" font-family="Arial,sans-serif" font-size="4" font-weight="700" fill="${icon.accent}">${text}</text>`;
    case "warning":
      return `<path d="m12 6.5 6 10.5H6z" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linejoin="round"/><path d="M12 10.4v3M12 15.6h.1" stroke="${icon.accent}" stroke-width="1.45" stroke-linecap="round"/>`;
    default:
      return `<path d="M7.5 9h9M7.5 12h9M7.5 15h6" stroke="${icon.accent}" stroke-width="1.5" stroke-linecap="round"/>`;
  }
}

function fileSvg(icon: FileIcon) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="${esc(icon.label)}">
  <path d="M6.5 2.8h8.1L19.5 7.7v13.5H6.5a2 2 0 0 1-2-2V4.8a2 2 0 0 1 2-2Z" fill="${icon.color}"/>
  <path d="M14.6 2.8v4.9h4.9Z" fill="${icon.accent}" opacity=".82"/>
  <path d="M7 5.2h6.6v4.6h3.6v9H7Z" fill="#10161F" opacity=".18"/>
  ${fileGlyph(icon)}
</svg>
`;
}

function folderMarkGlyph(icon: FolderIcon) {
  switch (icon.mark) {
    case "open":
      return `<path d="M5.2 14.7 6.7 11h12.1l-1.3 4.9c-.2.8-.9 1.3-1.7 1.3H6.4c-.8 0-1.4-.9-1.1-1.6z" fill="${icon.accent}"/>`;
    case "src":
    case "code":
      return `<path d="m10.2 12-1.9 1.8 1.9 1.8M14.2 12l1.9 1.8-1.9 1.8" fill="none" stroke="${icon.accent}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "grid":
      return `<path d="M9 11.3h2.1v2.1H9zM12.9 11.3H15v2.1h-2.1zM9 15h2.1v2.1H9zM12.9 15H15v2.1h-2.1z" fill="${icon.accent}"/>`;
    case "hook":
      return `<path d="M13.6 11.2v3.6a2.3 2.3 0 0 1-4.6 0v-.6M13.6 11.2a1.7 1.7 0 1 1 2.5 1.5" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linecap="round"/>`;
    case "tool":
      return `<path d="m9.1 16.6 5.8-5.8M13.8 10.8l1.6-.4.4-1.6 1.1 1.1-.4 1.6-1.6.4z" fill="none" stroke="${icon.accent}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "check":
      return `<path d="m8.7 14.6 2 2 4.6-5" fill="none" stroke="${icon.accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "gear":
      return `<circle cx="12" cy="14" r="1.8" fill="none" stroke="${icon.accent}" stroke-width="1.25"/><path d="M12 10.7v1M12 16.3v1M8.7 14h1M14.3 14h1M9.7 11.7l.7.7M13.6 15.6l.7.7M14.3 11.7l-.7.7M10.4 15.6l-.7.7" stroke="${icon.accent}" stroke-width="1.25" stroke-linecap="round"/>`;
    case "image":
      return `<rect x="8" y="11" width="8.2" height="5.6" rx="1" fill="none" stroke="${icon.accent}" stroke-width="1.2"/><path d="m8.8 16 2.2-2.1 1.5 1.4 1-1 1.8 1.7" fill="none" stroke="${icon.accent}" stroke-width="1.1" stroke-linecap="round"/>`;
    case "doc":
      return `<path d="M9 11.3h6M9 13.8h6M9 16.3h3.8" stroke="${icon.accent}" stroke-width="1.25" stroke-linecap="round"/>`;
    case "term":
      return `<path d="m9 12.1 2 1.9-2 1.9M12.4 16h3" fill="none" stroke="${icon.accent}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "rs":
    case "tau":
    case "pkg":
    case "db":
    case "api":
    case "ts":
    case "ai":
    case "cx":
      return `<text x="12" y="16.1" text-anchor="middle" font-family="Arial,sans-serif" font-size="4.6" font-weight="700" fill="${icon.accent}">${icon.mark.toUpperCase()}</text>`;
    case "link":
      return `<path d="M10.4 15.5a2.1 2.1 0 0 1-3 0 2.1 2.1 0 0 1 0-3l1.8-1.8a2.1 2.1 0 0 1 3 0M13.6 12.5a2.1 2.1 0 0 1 3 0 2.1 2.1 0 0 1 0 3l-1.8 1.8a2.1 2.1 0 0 1-3 0M10 14l4-4" fill="none" stroke="${icon.accent}" stroke-width="1.2" stroke-linecap="round"/>`;
    case "style":
      return `<path d="M12 10.6a3.9 3.9 0 0 0 0 7.8h.8c.6 0 .9-.8.4-1.1-.4-.4-.1-1 .5-1h.7c1 0 1.7-.7 1.7-1.9a3.9 3.9 0 0 0-4.1-3.8z" fill="none" stroke="${icon.accent}" stroke-width="1.1"/><circle cx="10.3" cy="13.8" r=".45" fill="${icon.accent}"/><circle cx="12" cy="12.7" r=".45" fill="${icon.accent}"/><circle cx="13.7" cy="13.8" r=".45" fill="${icon.accent}"/>`;
    case "lang":
      return `<circle cx="12" cy="14.2" r="3.8" fill="none" stroke="${icon.accent}" stroke-width="1.15"/><path d="M8.5 14.2h7M12 10.5c1 1 1.5 2.2 1.5 3.7S13 16.9 12 18M12 10.5c-1 1-1.5 2.2-1.5 3.7S11 16.9 12 18" fill="none" stroke="${icon.accent}" stroke-width="1.05" stroke-linecap="round"/>`;
    case "lock":
      return `<rect x="8.5" y="13.2" width="7" height="4.4" rx="1.1" fill="${icon.accent}"/><path d="M10 13.2v-1.1a2 2 0 0 1 4 0v1.1" fill="none" stroke="${icon.accent}" stroke-width="1.2"/>`;
    case "net":
      return `<circle cx="9" cy="12" r="1.1" fill="${icon.accent}"/><circle cx="15" cy="12" r="1.1" fill="${icon.accent}"/><circle cx="12" cy="17" r="1.1" fill="${icon.accent}"/><path d="M10 12h4M9.6 13l1.8 3M14.4 13l-1.8 3" stroke="${icon.accent}" stroke-width="1.05" stroke-linecap="round"/>`;
    case "cloud":
      return `<path d="M9.3 16.7h5.5a2 2 0 0 0 .3-4 3.1 3.1 0 0 0-5.9.8 1.7 1.7 0 0 0 .1 3.2z" fill="none" stroke="${icon.accent}" stroke-width="1.15" stroke-linejoin="round"/>`;
    case "mobile":
      return `<rect x="9.6" y="10.3" width="4.8" height="7.2" rx="1" fill="none" stroke="${icon.accent}" stroke-width="1.15"/><path d="M11.2 11.5h1.6M11.5 16.4h1" stroke="${icon.accent}" stroke-width="1" stroke-linecap="round"/>`;
    case "graph":
      return `<path d="M8.7 17.2h7M9.8 16.8v-2.5M12 16.8v-5M14.2 16.8v-3.6" stroke="${icon.accent}" stroke-width="1.15" stroke-linecap="round"/>`;
    case "puzzle":
      return `<path d="M9.1 11.3h2.2c0-.9.6-1.5 1.4-1.5s1.4.6 1.4 1.5h1.8v2.2c-.9 0-1.5.6-1.5 1.4s.6 1.4 1.5 1.4v1.4H9.1v-1.8c.8 0 1.4-.6 1.4-1.4s-.6-1.4-1.4-1.4z" fill="none" stroke="${icon.accent}" stroke-width="1.05" stroke-linejoin="round"/>`;
    case "git":
      return `<path d="m12 10.7 3.3 3.3-3.3 3.3L8.7 14z" fill="none" stroke="${icon.accent}" stroke-width="1.2"/><circle cx="11" cy="13" r=".7" fill="${icon.accent}"/><circle cx="13.1" cy="15.1" r=".7" fill="${icon.accent}"/>`;
    case "box":
      return `<path d="m12 10.7 4 2.1v3.8l-4 2-4-2v-3.8zM8 12.8l4 2.1 4-2.1M12 14.9v3.7" fill="none" stroke="${icon.accent}" stroke-width="1.15" stroke-linejoin="round"/>`;
    case "route":
      return `<path d="M8.6 16.3c4.5 0 2.4-4.5 6.8-4.5M8.6 16.3l1.5-1.5M8.6 16.3l1.5 1.5M15.4 11.8l-1.5-1.5M15.4 11.8l-1.5 1.5" fill="none" stroke="${icon.accent}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "store":
      return `<path d="M8.3 12.3h7.4M8.3 14.2h7.4M8.3 16.1h7.4" stroke="${icon.accent}" stroke-width="1.25" stroke-linecap="round"/><path d="M9.4 10.5h5.2" stroke="${icon.accent}" stroke-width="1.25" stroke-linecap="round"/>`;
    case "spark":
      return `<path d="M12 10.2 13 13l2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1z" fill="${icon.accent}"/>`;
    default:
      return "";
  }
}

function folderMark(icon: FolderIcon) {
  if (!icon.mark || icon.mark === "open") {
    return "";
  }

  return `<g transform="translate(6.2 4.9) scale(.68)">${folderMarkGlyph(icon)}</g>`;
}

function folderSvg(icon: FolderIcon, open = false) {
  const body = open
    ? `<path d="M3.2 8.1c0-1 .8-1.8 1.8-1.8h5l1.8 2.2H19c1 0 1.8.8 1.8 1.8v1.4H6.9c-.8 0-1.5.5-1.8 1.2l-1.9 4.7z" fill="${icon.color}"/>
  <path d="M4.6 18.1c-.9 0-1.5-.8-1.2-1.7l1.7-4.7c.3-.7 1-1.2 1.8-1.2h13.5c.9 0 1.5.8 1.3 1.7L20.1 17c-.3.7-1 1.2-1.8 1.2H4.6Z" fill="${icon.color}"/>`
    : `<path d="M3.2 8c0-1 .8-1.8 1.8-1.8h5l1.9 2.2H19c1 0 1.8.8 1.8 1.8v6.4c0 1-.8 1.8-1.8 1.8H5c-1 0-1.8-.8-1.8-1.8z" fill="${icon.color}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" role="img" aria-label="${esc(icon.label)}">
  ${body}
  <path d="M4.7 9.5h14.6v1.8H4.7z" fill="${icon.accent}" opacity=".48"/>
  <path d="M5.5 8.4h4.2l1.2 1.5H5.5z" fill="${icon.accent}" opacity=".8"/>
  ${folderMark(icon)}
</svg>
`;
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function variantIconRoot(variant: ThemeVariant) {
  return variant.directory ? `icons/${variant.directory}` : "icons";
}

function variantFileDir(variant: ThemeVariant) {
  return join(root, variantIconRoot(variant), "files");
}

function variantFolderDir(variant: ThemeVariant) {
  return join(root, variantIconRoot(variant), "folders");
}

function variantIconPath(variant: ThemeVariant, kind: "files" | "folders", id: string) {
  return `./${variantIconRoot(variant)}/${kind}/${id}.svg`;
}

function applyVariant<T extends Pick<FileIcon, "color" | "accent">>(icon: T, variant: ThemeVariant): T {
  return {
    ...icon,
    ...variant.transform(icon),
  };
}

function iconDefinitions(variant: ThemeVariant) {
  return Object.fromEntries([
    ...fileIcons.map((icon) => [icon.id, variantIconPath(variant, "files", icon.id)]),
    ...folderIcons.map((icon) => [icon.id, variantIconPath(variant, "folders", icon.id)]),
  ]);
}

function themeContribution(variant: ThemeVariant) {
  return {
    id: variant.id,
    name: variant.name,
    description: variant.description,
    iconDefinitions: iconDefinitions(variant),
    fileExtensions,
    filenames,
    folders,
    expandedFolders: Object.fromEntries(Object.keys(folders).map((name) => [name, "folder-open"])),
    defaultFile: "file",
    defaultFolder: "folder",
    defaultFolderOpen: "folder-open",
  };
}

function manifest() {
  return {
    $schema: "https://athas.dev/schemas/extension.json",
    id: "athas.icon-theme.athas-icons",
    name: "athas-icons",
    displayName: "Athas Icons",
    version: "0.1.0",
    description: "Original duotone file and folder icons for Athas.",
    publisher: "Athas",
    categories: ["Icon Theme"],
    activationEvents: themeVariants.map((variant) => `onIconTheme:${variant.id}`),
    license: "MIT",
    bundled: true,
    icons: themeVariants.map(themeContribution),
  };
}

function previewHtml() {
  const initialVariant = themeVariants[0];
  const variantPaths = Object.fromEntries(themeVariants.map((variant) => [variant.id, `./${variantIconRoot(variant)}`]));
  const variantPalettes = {
    "athas-icons": {
      bg: "#11151B",
      panel: "#171D25",
      panel2: "#1D2530",
      text: "#ECF1F7",
      muted: "#96A3B4",
      line: "#2A3442",
    },
    "athas-icons-dimmed": {
      bg: "#151A22",
      panel: "#1B222C",
      panel2: "#202934",
      text: "#E4EAF2",
      muted: "#9AA6B6",
      line: "#303B4A",
    },
    "athas-icons-light": {
      bg: "#F6F8FB",
      panel: "#FFFFFF",
      panel2: "#EEF2F7",
      text: "#182233",
      muted: "#637086",
      line: "#D8E0EA",
    },
  };
  const variantOptions = themeVariants
    .map((variant) => `<option value="${esc(variant.id)}">${esc(variant.name)}</option>`)
    .join("\n");
  const fileCards = fileIcons
    .map(
      (icon) => `<article class="card" data-type="file" data-icon-id="${esc(icon.id)}" data-keywords="${esc(`${icon.label} ${icon.id} ${icon.kind} ${icon.text ?? ""}`)}">
        <img src="${variantIconPath(initialVariant, "files", icon.id)}" alt="" data-type="file" data-icon-id="${esc(icon.id)}">
        <div>
          <strong>${esc(icon.label)}</strong>
          <span>${esc(icon.id)} · ${esc(icon.kind)}</span>
        </div>
      </article>`,
    )
    .join("\n");
  const folderCards = folderIcons
    .map(
      (icon) => `<article class="card" data-type="folder" data-icon-id="${esc(icon.id)}" data-keywords="${esc(`${icon.label} ${icon.id} ${icon.mark ?? ""}`)}">
        <img src="${variantIconPath(initialVariant, "folders", icon.id)}" alt="" data-type="folder" data-icon-id="${esc(icon.id)}">
        <div>
          <strong>${esc(icon.label)}</strong>
          <span>${esc(icon.id)} · ${esc(icon.mark ?? "base")}</span>
        </div>
      </article>`,
    )
    .join("\n");
  const sampleRows = [
    { type: "folder", id: "folder-codex", name: ".codex", detail: "AI workspace config", depth: 0 },
    { type: "folder", id: "folder-src", name: "src", detail: "source", depth: 0 },
    { type: "folder", id: "folder-components", name: "components", detail: "ui", depth: 1 },
    { type: "file", id: "react", name: "icon-preview.tsx", detail: "React component", depth: 2 },
    { type: "file", id: "typescript", name: "generate-icons.ts", detail: "TypeScript", depth: 1 },
    { type: "folder", id: "folder-workflows", name: ".github/workflows", detail: "automation", depth: 0 },
    { type: "file", id: "github-actions", name: "release.yml", detail: "GitHub Actions", depth: 1 },
    { type: "file", id: "codex", name: "AGENTS.md", detail: "Codex instructions", depth: 0 },
    { type: "file", id: "docker-compose", name: "docker-compose.yml", detail: "containers", depth: 0 },
    { type: "file", id: "mermaid", name: "architecture.mmd", detail: "diagram", depth: 0 },
  ];
  const sampleExplorerRows = sampleRows
    .map(
      (row) => `<div class="explorer-row" style="--depth:${row.depth}">
        <img src="${variantIconPath(initialVariant, row.type === "folder" ? "folders" : "files", row.id)}" alt="" data-type="${row.type}" data-icon-id="${esc(row.id)}">
        <span>${esc(row.name)}</span>
        <em>${esc(row.detail)}</em>
      </div>`,
    )
    .join("\n");
  const colorwayCompare = themeVariants
    .map((variant) => {
      const fileRoot = variantIconRoot(variant);
      return `<article class="compare-card">
        <div>
          <strong>${esc(variant.name)}</strong>
          <span>${esc(variant.id)}</span>
        </div>
        <div class="compare-icons">
          <img src="./${fileRoot}/folders/folder-src.svg" alt="">
          <img src="./${fileRoot}/files/typescript.svg" alt="">
          <img src="./${fileRoot}/files/react.svg" alt="">
          <img src="./${fileRoot}/files/codex.svg" alt="">
          <img src="./${fileRoot}/files/github-actions.svg" alt="">
        </div>
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Athas Icons Preview</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #11151b;
      --panel: #171d25;
      --panel-2: #1d2530;
      --text: #ecf1f7;
      --muted: #96a3b4;
      --line: #2a3442;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.4;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 20px;
      margin-bottom: 28px;
    }
    h1, h2, p { margin: 0; }
    h1 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0;
    }
    p {
      color: var(--muted);
      max-width: 720px;
      margin-top: 8px;
      font-size: 14px;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 190px auto auto;
      gap: 12px;
      align-items: center;
      margin-bottom: 20px;
    }
    .search,
    .select {
      height: 38px;
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      padding: 0 12px;
      font: inherit;
      font-size: 14px;
      outline: none;
    }
    .search:focus,
    .select:focus {
      border-color: #4e91d9;
      box-shadow: 0 0 0 3px rgba(78, 145, 217, .18);
    }
    .stats {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .segmented {
      display: inline-flex;
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 3px;
    }
    .segmented button {
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      padding: 0 10px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .segmented button.is-active {
      background: var(--panel-2);
      color: var(--text);
    }
    .preview-workbench {
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      gap: 14px;
      margin-bottom: 28px;
    }
    .explorer,
    .inspector,
    .compare {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .panel-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding: 10px 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .explorer-list {
      padding: 6px;
    }
    .explorer-row {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      border-radius: 6px;
      padding-right: 8px;
      padding-left: calc(8px + var(--depth) * 16px);
    }
    .explorer-row:hover {
      background: var(--panel-2);
    }
    .explorer-row img {
      width: 18px;
      height: 18px;
    }
    .explorer-row span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .explorer-row em {
      color: var(--muted);
      font-size: 11px;
      font-style: normal;
    }
    .inspector {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 100%;
    }
    .inspector-body {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      gap: 16px;
      align-items: center;
      padding: 18px;
    }
    .inspector-preview {
      display: grid;
      place-items: center;
      width: 96px;
      height: 96px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
    }
    .inspector-preview img {
      width: 52px;
      height: 52px;
    }
    .inspector-body strong,
    .inspector-body code,
    .inspector-body span {
      display: block;
    }
    .inspector-body strong {
      font-size: 18px;
      margin-bottom: 4px;
    }
    .inspector-body code {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .inspector-body span {
      color: var(--muted);
      font-size: 13px;
    }
    .compare {
      margin-bottom: 28px;
      padding: 12px;
    }
    .compare-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .compare-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 10px;
    }
    .compare-card strong,
    .compare-card span {
      display: block;
      white-space: nowrap;
    }
    .compare-card strong {
      font-size: 13px;
    }
    .compare-card span {
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
    }
    .compare-icons {
      display: flex;
      gap: 6px;
    }
    .compare-icons img {
      width: 22px;
      height: 22px;
    }
    section + section { margin-top: 36px; }
    h2 {
      font-size: 16px;
      margin-bottom: 14px;
      font-weight: 650;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 10px;
    }
    .card {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 10px;
      cursor: pointer;
    }
    .card.is-selected {
      border-color: #4e91d9;
      box-shadow: 0 0 0 3px rgba(78, 145, 217, .18);
    }
    .card[hidden] {
      display: none;
    }
    .card img {
      width: 28px;
      height: 28px;
      image-rendering: auto;
      flex: none;
    }
    .card div { min-width: 0; }
    .card strong,
    .card span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card strong {
      font-size: 13px;
      font-weight: 650;
    }
    .card span {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      margin-top: 2px;
    }
    .strip {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 10px;
      margin-bottom: 28px;
    }
    .strip img {
      width: 24px;
      height: 24px;
      justify-self: center;
    }
    .empty {
      display: none;
      border: 1px dashed var(--line);
      border-radius: 8px;
      color: var(--muted);
      padding: 18px;
      text-align: center;
      font-size: 13px;
    }
    .empty.is-visible {
      display: block;
    }
    @media (max-width: 720px) {
      header {
        display: block;
      }
      .meta {
        display: block;
        margin-top: 12px;
      }
      main {
        width: min(100vw - 20px, 1180px);
        padding-top: 20px;
      }
      .grid {
        grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
      }
      .toolbar {
        grid-template-columns: 1fr;
      }
      .preview-workbench {
        grid-template-columns: 1fr;
      }
      .stats {
        white-space: normal;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Athas Icons</h1>
        <p>Original duotone file and folder icons designed for the Athas explorer. This page is static and can be opened directly from disk.</p>
      </div>
      <span class="meta">${fileIcons.length} files / ${folderIcons.length} folders / ${themeVariants.length} colorways</span>
    </header>
    <div class="toolbar">
      <input class="search" id="icon-search" type="search" placeholder="Search icons" autocomplete="off">
      <select class="select" id="theme-variant" aria-label="Icon colorway">
        ${variantOptions}
      </select>
      <div class="segmented" aria-label="Icon type filter">
        <button type="button" class="is-active" data-filter-type="all">All</button>
        <button type="button" data-filter-type="file">Files</button>
        <button type="button" data-filter-type="folder">Folders</button>
      </div>
      <span class="stats" id="icon-stats">${fileIcons.length + folderIcons.length} icons shown</span>
    </div>
    <section class="compare" aria-label="Colorway comparison">
      <div class="panel-title">Colorways</div>
      <div class="compare-grid">
        ${colorwayCompare}
      </div>
    </section>
    <div class="preview-workbench">
      <section class="explorer" aria-label="Explorer sample">
        <div class="panel-title">Explorer Sample</div>
        <div class="explorer-list">
          ${sampleExplorerRows}
        </div>
      </section>
      <aside class="inspector" aria-label="Selected icon">
        <div class="panel-title">Selected Icon</div>
        <div class="inspector-body">
          <div class="inspector-preview">
            <img id="selected-icon-image" src="${variantIconPath(initialVariant, "files", "typescript")}" alt="">
          </div>
          <div>
            <strong id="selected-icon-title">TypeScript</strong>
            <code id="selected-icon-id">typescript</code>
            <span id="selected-icon-meta">file · code</span>
          </div>
        </div>
      </aside>
    </div>
    <div class="strip">
      ${fileIcons
        .slice(0, 36)
        .map(
          (icon) =>
            `<img src="${variantIconPath(initialVariant, "files", icon.id)}" alt="${esc(icon.label)}" data-type="file" data-icon-id="${esc(icon.id)}">`,
        )
        .join("\n      ")}
    </div>
    <section class="icons-section">
      <h2>File Icons</h2>
      <div class="grid">
        ${fileCards}
      </div>
    </section>
    <section class="icons-section">
      <h2>Folder Icons</h2>
      <div class="grid">
        ${folderCards}
      </div>
    </section>
    <div class="empty" id="empty-state">No icons match the current search.</div>
  </main>
  <script>
    const search = document.getElementById("icon-search");
    const variantSelect = document.getElementById("theme-variant");
    const stats = document.getElementById("icon-stats");
    const empty = document.getElementById("empty-state");
    const cards = Array.from(document.querySelectorAll(".card"));
    const sections = Array.from(document.querySelectorAll(".icons-section"));
    const variantImages = Array.from(document.querySelectorAll("img[data-icon-id]"));
    const filterButtons = Array.from(document.querySelectorAll("[data-filter-type]"));
    const selectedIconImage = document.getElementById("selected-icon-image");
    const selectedIconTitle = document.getElementById("selected-icon-title");
    const selectedIconId = document.getElementById("selected-icon-id");
    const selectedIconMeta = document.getElementById("selected-icon-meta");
    const variantPaths = ${JSON.stringify(variantPaths)};
    const variantPalettes = ${JSON.stringify(variantPalettes)};
    let activeType = "all";
    let selectedCard = cards.find((card) => card.dataset.iconId === "typescript") || cards[0];

    function updateVariant() {
      const variantId = variantSelect.value;
      const basePath = variantPaths[variantId] || variantPaths["athas-icons"];
      const palette = variantPalettes[variantId] || variantPalettes["athas-icons"];

      for (const [key, value] of Object.entries(palette)) {
        document.documentElement.style.setProperty("--" + key.replace("panel2", "panel-2"), value);
      }

      for (const image of variantImages) {
        const directory = image.dataset.type === "folder" ? "folders" : "files";
        image.src = basePath + "/" + directory + "/" + image.dataset.iconId + ".svg";
      }

      updateSelectedIcon();
    }

    function updateSelectedIcon() {
      if (!selectedCard) return;
      const image = selectedCard.querySelector("img");
      const title = selectedCard.querySelector("strong");
      const meta = selectedCard.querySelector("span");
      cards.forEach((card) => card.classList.toggle("is-selected", card === selectedCard));
      selectedIconImage.src = image.src;
      selectedIconTitle.textContent = title.textContent;
      selectedIconId.textContent = selectedCard.dataset.iconId;
      selectedIconMeta.textContent = selectedCard.dataset.type + " · " + meta.textContent;
    }

    function updateFilter() {
      const query = search.value.trim().toLowerCase();
      let visible = 0;

      for (const card of cards) {
        const typeMatches = activeType === "all" || card.dataset.type === activeType;
        const queryMatches = !query || card.dataset.keywords.toLowerCase().includes(query);
        const matches = typeMatches && queryMatches;
        card.hidden = !matches;
        if (matches) visible += 1;
      }

      for (const section of sections) {
        const hasVisibleCards = Array.from(section.querySelectorAll(".card")).some((card) => !card.hidden);
        section.hidden = !hasVisibleCards;
      }

      stats.textContent = visible + " icon" + (visible === 1 ? "" : "s") + " shown";
      empty.classList.toggle("is-visible", visible === 0);
    }

    search.addEventListener("input", updateFilter);
    variantSelect.addEventListener("change", updateVariant);
    for (const button of filterButtons) {
      button.addEventListener("click", () => {
        activeType = button.dataset.filterType;
        filterButtons.forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
        updateFilter();
      });
    }
    for (const card of cards) {
      card.addEventListener("click", () => {
        selectedCard = card;
        updateSelectedIcon();
      });
    }
    updateVariant();
    updateFilter();
  </script>
</body>
</html>
`;
}

for (const variant of themeVariants) {
  const filesDir = variantFileDir(variant);
  const foldersDir = variantFolderDir(variant);

  mkdirSync(filesDir, { recursive: true });
  mkdirSync(foldersDir, { recursive: true });

  for (const icon of fileIcons) {
    write(join(filesDir, `${icon.id}.svg`), fileSvg(applyVariant(icon, variant)));
  }

  for (const icon of folderIcons) {
    write(join(foldersDir, `${icon.id}.svg`), folderSvg(applyVariant(icon, variant), icon.id === "folder-open"));
  }
}

write(join(root, "extension.json"), `${JSON.stringify(manifest(), null, 2)}\n`);
write(join(root, "preview.html"), previewHtml());
write(
  join(root, "LICENSE"),
  `MIT License

Copyright (c) 2026 Athas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
);
