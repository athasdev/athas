function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const base = 1024;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length - 1);

  return `${(bytes / base ** unitIndex).toFixed(1)} ${units[unitIndex]}`;
}

export { formatFileSize };
