import { describe, expect, it } from "vite-plus/test";
import {
  createAcpToolLocationTree,
  OPEN_TOOL_LOCATION_COMMAND,
} from "@/features/ai/lib/acp-tool-location-tree";

describe("ACP tool location tree", () => {
  it("groups tool locations into an expanded selectable path hierarchy", () => {
    const tree = createAcpToolLocationTree([
      { path: "src/features/ai/chat.tsx", line: 42 },
      { path: "src/features/editor/editor.tsx", line: 8 },
      { path: "README.md" },
    ]);

    expect(tree).toMatchObject({
      type: "tree",
      label: "Tool locations",
      items: [
        {
          id: "directory:src",
          title: "src",
          expanded: true,
          children: [
            {
              id: "directory:src/features",
              children: [
                {
                  id: "directory:src/features/ai",
                  children: [
                    {
                      title: "chat.tsx",
                      meta: "line 42",
                      onSelect: {
                        command: OPEN_TOOL_LOCATION_COMMAND,
                        args: ["src/features/ai/chat.tsx"],
                      },
                    },
                  ],
                },
                {
                  id: "directory:src/features/editor",
                  children: [{ title: "editor.tsx", meta: "line 8" }],
                },
              ],
            },
          ],
        },
        { title: "README.md" },
      ],
    });
  });

  it("keeps a single location in the compact text presentation", () => {
    expect(createAcpToolLocationTree([{ path: "src/main.ts" }])).toBeUndefined();
  });
});
