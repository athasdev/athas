// @vitest-environment jsdom
import { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAgentDraft } from "../hooks/use-agent-draft";
import {
  captureAgentDrafts,
  peekAgentDraft,
  restoreAgentDrafts,
  type AgentWindowDraft,
} from "../detached/agent-window-drafts";

let root: Root;
let container: HTMLDivElement;
const restore = vi.fn();
const suspended = new Promise(() => {});
const draft = (text: string): AgentWindowDraft => ({
  text,
  images: [],
  bufferIds: [],
  filePaths: [],
  editorContexts: [],
});
function Pending(): never {
  throw suspended;
}
function Surface({
  id,
  value,
  pending = false,
}: {
  id: string;
  value: AgentWindowDraft;
  pending?: boolean;
}) {
  useAgentDraft({ surfaceId: id, readDraft: () => value, restoreDraft: restore });
  return pending ? <Pending /> : <div>{value.text}</div>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  restore.mockClear();
  restoreAgentDrafts({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreAgentDrafts({});
});

describe("Agent draft lifecycle", () => {
  it("captures committed drafts rather than an interrupted render", async () => {
    await act(async () =>
      root.render(
        <Suspense>
          <Surface id="a" value={draft("saved")} />
        </Suspense>,
      ),
    );
    await act(async () =>
      startTransition(() =>
        root.render(
          <Suspense>
            <Surface id="a" value={draft("uncommitted")} pending />
          </Suspense>,
        ),
      ),
    );
    expect(container.textContent).toBe("saved");
    expect(captureAgentDrafts().a.text).toBe("saved");
    await act(async () =>
      root.render(
        <Suspense>
          <Surface id="a" value={draft("latest")} />
        </Suspense>,
      ),
    );
    expect(captureAgentDrafts().a.text).toBe("latest");
  });

  it("stores the previous surface draft before registering another surface", async () => {
    restoreAgentDrafts({ b: draft("restored b") });
    await act(async () => root.render(<Surface id="a" value={draft("draft a")} />));
    await act(async () => root.render(<Surface id="b" value={draft("draft b")} />));
    expect(peekAgentDraft("a")?.text).toBe("draft a");
    expect(restore).toHaveBeenCalledExactlyOnceWith(draft("restored b"));
    expect(captureAgentDrafts().b.text).toBe("draft b");
    await act(async () => root.render(null));
    expect(peekAgentDraft("b")?.text).toBe("draft b");
  });

  it("restores once and captures the latest attachments on close", async () => {
    restoreAgentDrafts({ a: draft("restored") });
    await act(async () => root.render(<Surface id="a" value={draft("typed")} />));
    const latest = {
      ...draft("typed later"),
      filePaths: ["/repo/latest.ts"],
      bufferIds: ["buffer-1"],
    };
    await act(async () => root.render(<Surface id="a" value={latest} />));
    expect(restore).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    expect(peekAgentDraft("a")).toEqual(latest);
  });
});
