/**
 * Get the programming language from a filename based on its extension
 */
export const getLanguageFromFilename = (filename: string): string => {
  const lowerFilename = filename.toLowerCase();

  // Handle compound extensions like .html.erb
  if (lowerFilename.endsWith(".html.erb")) {
    return "ERB";
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  const languageMap: { [key: string]: string } = {
    rb: "Ruby",
    js: "JavaScript",
    jsx: "JavaScript",
    ts: "TypeScript",
    tsx: "TypeScript",
    py: "Python",
    java: "Java",
    css: "CSS",
    scss: "SCSS",
    sass: "Sass",
    json: "JSON",
    md: "Markdown",
    markdown: "Markdown",
    sh: "Shell",
    bash: "Shell",
    yml: "YAML",
    yaml: "YAML",
    sql: "SQL",
    html: "HTML",
    xml: "XML",
    erb: "ERB",
    php: "PHP",
    phtml: "PHP",
    php3: "PHP",
    php4: "PHP",
    php5: "PHP",
    php7: "PHP",
    csharp: "C#",
    go: "Go",
    rs: "Rust",
    toml: "TOML",
  };
  return languageMap[ext || ""] || "Text";
};

/**
 * Check if a file is a SQLite database based on its extension
 */
export const isSQLiteFile = (path: string): boolean => {
  return (
    path.toLowerCase().endsWith(".sqlite") ||
    path.toLowerCase().endsWith(".db") ||
    path.toLowerCase().endsWith(".sqlite3")
  );
};

/**
 * Check if a file is an image based on its extension
 */
export const isImageFile = (path: string): boolean => {
  const lowerPath = path.toLowerCase();
  return (
    lowerPath.endsWith(".png") ||
    lowerPath.endsWith(".jpg") ||
    lowerPath.endsWith(".jpeg") ||
    lowerPath.endsWith(".gif") ||
    lowerPath.endsWith(".bmp") ||
    lowerPath.endsWith(".svg") ||
    lowerPath.endsWith(".webp") ||
    lowerPath.endsWith(".ico") ||
    lowerPath.endsWith(".tiff") ||
    lowerPath.endsWith(".tif") ||
    lowerPath.endsWith(".avif") ||
    lowerPath.endsWith(".heic") ||
    lowerPath.endsWith(".heif") ||
    lowerPath.endsWith(".jfif") ||
    lowerPath.endsWith(".pjpeg") ||
    lowerPath.endsWith(".pjp") ||
    lowerPath.endsWith(".apng")
  );
};

/**
 * Extract filename from a path
 */
export const getFilenameFromPath = (path: string): string => {
  return path.split("/").pop() || "Untitled";
};

/**
 * Get the directory path from a file path
 */
const getDirectoryFromPath = (filePath: string): string => {
  const pathParts = filePath.split("/");
  pathParts.pop(); // Remove the filename
  return pathParts.join("/");
};

/**
 * Get the root directory path from a list of files
 */
export const getRootPath = (files: any[]): string => {
  if (files.length === 0) return "";

  const firstFile = files[0];
  if (!firstFile?.path || typeof firstFile.path !== "string") return "";

  return getDirectoryFromPath(firstFile.path);
};
