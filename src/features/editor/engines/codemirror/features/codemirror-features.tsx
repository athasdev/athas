import type { CodeMirrorHost } from "../host";

/** Every editor feature rendered into a CodeMirror editor once its view exists. */
export function CodeMirrorFeatures({ host }: { host: CodeMirrorHost }) {
  void host;
  return null;
}
