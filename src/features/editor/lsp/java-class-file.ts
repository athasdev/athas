export function isJavaClassFileUri(uri: string): boolean {
  return uri.startsWith("jdt://");
}

export function getJavaClassFileName(uri: string): string {
  const path = uri.split("?", 1)[0] ?? uri;
  const encodedName = path.slice(path.lastIndexOf("/") + 1);

  try {
    return decodeURIComponent(encodedName) || "Java Class";
  } catch {
    return encodedName || "Java Class";
  }
}
