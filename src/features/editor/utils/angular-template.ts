/** The language id Angular component templates open with. */
export const ANGULAR_TEMPLATE_LANGUAGE_ID = "angular";

/** Whether a file is an Angular component template (`*.component.html`, `*.ng.html`). */
export function isAngularTemplatePath(filePath: string): boolean {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? filePath.toLowerCase();
  return fileName.endsWith(".component.html") || fileName.endsWith(".ng.html");
}
