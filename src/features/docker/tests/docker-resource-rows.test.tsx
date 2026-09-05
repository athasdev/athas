import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { DockerResourceRow, ImageRow, VolumeRow } from "../components/docker-resource-rows";

describe("Docker resource actions", () => {
  it("keeps informational volumes out of the keyboard action order", () => {
    const markup = renderToStaticMarkup(
      <VolumeRow
        volume={{ name: "workspace-data", driver: "local", scope: "local", mountpoint: "/data" }}
      />,
    );
    expect(markup).toContain("workspace-data");
    expect(markup).toContain("/data");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('type="button"');
  });

  it("keeps selectable resources as buttons", () => {
    const markup = renderToStaticMarkup(<DockerResourceRow title="web" onClick={() => {}} />);
    expect(markup).toContain("<button");
    expect(markup).toContain('type="button"');
    expect(markup).toContain("web");
  });

  it("keeps image management accessible without a clickable resource row", () => {
    const markup = renderToStaticMarkup(
      <ImageRow
        image={{
          id: "image-1",
          repository: "app",
          tag: "latest",
          digest: "sha256:test",
          size: "25MB",
          createdSince: "today",
        }}
        busy={false}
        onRun={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(markup).toContain('aria-label="Actions for app:latest"');
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toContain("25MB");
  });
});
