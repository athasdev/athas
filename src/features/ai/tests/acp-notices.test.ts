import { describe, expect, it } from "vite-plus/test";
import { acpNoticeToChatEvent } from "@/features/ai/lib/acp-notices";
import { useAcpNoticesStore } from "@/features/ai/stores/acp-notices.store";

describe("ACP notices", () => {
  it("shows a notice as a timeline line in its severity", () => {
    const timestamp = new Date(0);
    const notice = { id: "n1", title: "Rate limited", description: "Retrying", timestamp };

    expect(acpNoticeToChatEvent({ ...notice, severity: "warning" })).toEqual({
      id: "notice-n1",
      category: "notice",
      label: "Rate limited",
      detail: "Retrying",
      state: "warning",
      timestamp,
    });
    expect(acpNoticeToChatEvent({ ...notice, severity: "error" }).state).toBe("error");
    expect(
      acpNoticeToChatEvent({ ...notice, severity: "_custom", description: null }),
    ).toMatchObject({ state: "info", detail: undefined });
  });

  it("keeps the latest notices of each session", () => {
    const { actions } = useAcpNoticesStore.getState();
    for (let index = 0; index < 25; index++) {
      actions.add("s1", { severity: "info", title: `Notice ${index}`, description: null });
    }
    actions.add("s2", { severity: "info", title: "Other", description: null });

    const notices = useAcpNoticesStore.getState().notices;
    expect(notices.s1).toHaveLength(20);
    expect(notices.s1[0].title).toBe("Notice 5");
    expect(notices.s2.map((notice) => notice.title)).toEqual(["Other"]);
  });
});
