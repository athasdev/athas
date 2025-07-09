// Language mapping for Prism.js
export const mapLanguage = (lang: string): string => {
  const langMap: { [key: string]: string } = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    sh: "bash",
    shell: "bash",
    cs: "csharp",
    kt: "kotlin",
    rs: "rust",
    cpp: "cpp",
    cc: "cpp",
    "c++": "cpp",
    cxx: "cpp",
    hpp: "cpp",
    h: "c",
    yml: "yaml",
    dockerfile: "docker",
    tf: "hcl",
    hcl: "hcl",
    vue: "markup",
    svelte: "markup",
    html: "markup",
    xml: "markup",
    jsx: "jsx",
    tsx: "tsx",
  };

  return langMap[lang.toLowerCase()] || lang.toLowerCase();
};

// Get relative time string
export const getRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Format time for display
export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
