import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { AcpCapabilitiesPanel } from "@/features/ai/acp-inspector/components/acp-capabilities-panel";
import { AcpTrafficLog } from "@/features/ai/acp-inspector/components/acp-traffic-log";
import { buildTrafficMessages } from "@/features/ai/acp-inspector/lib/acp-traffic-messages";

describe("ACP inspector panels", () => {
  it("lists messages with their method, id and latency", () => {
    const messages = buildTrafficMessages([
      {
        seq: 0,
        timestampMs: 1000,
        direction: "out",
        line: '{"jsonrpc":"2.0","id":3,"method":"session/new","params":{}}',
        truncated: false,
        originalBytes: 0,
      },
      {
        seq: 1,
        timestampMs: 1250,
        direction: "in",
        line: '{"jsonrpc":"2.0","id":3,"result":{"sessionId":"s1"}}',
        truncated: false,
        originalBytes: 0,
      },
    ]);

    const markup = renderToStaticMarkup(
      <AcpTrafficLog
        messages={messages}
        messagesByKey={new Map(messages.map((message) => [message.key, message]))}
        emptyMessage="Nothing"
        onCopy={() => {}}
      />,
    );

    expect(markup).toContain("session/new");
    expect(markup).toContain("250 ms");
    expect(markup).toContain('aria-expanded="false"');
  });

  it("renders only the rows near the top of a long log", () => {
    const messages = buildTrafficMessages(
      Array.from({ length: 500 }, (_, seq) => ({
        seq,
        timestampMs: 1000 + seq,
        direction: "stderr" as const,
        line: `stderr-line-${seq}.`,
        truncated: false,
        originalBytes: 0,
      })),
    );

    const markup = renderToStaticMarkup(
      <AcpTrafficLog
        messages={messages}
        messagesByKey={new Map(messages.map((message) => [message.key, message]))}
        emptyMessage="Nothing"
        onCopy={() => {}}
      />,
    );

    expect(markup).toContain("stderr-line-0.");
    expect(markup).not.toContain("stderr-line-499.");
    expect(markup.match(/data-traffic-key=/g)?.length ?? 0).toBeLessThan(100);
  });

  it("explains an empty log", () => {
    const markup = renderToStaticMarkup(
      <AcpTrafficLog
        messages={[]}
        messagesByKey={new Map()}
        emptyMessage="Nothing yet"
        onCopy={() => {}}
      />,
    );

    expect(markup).toContain("Nothing yet");
  });

  it("shows what each side declared in initialize", () => {
    const markup = renderToStaticMarkup(
      <AcpCapabilitiesPanel
        initialize={{
          request: {
            id: 0,
            method: "initialize",
            params: { clientCapabilities: { terminal: true } },
          },
          response: null,
        }}
      />,
    );

    expect(markup).toContain("Client capabilities");
    expect(markup).toContain("&quot;terminal&quot;: true");
    expect(markup).toContain("Waiting for the agent");
  });
});
