import { describe, expect, it } from "vite-plus/test";
import {
  collectText,
  extractLocalServerUrls,
  getLocalServerPort,
} from "../services/dev-server-urls";

describe("dev server addresses", () => {
  it("finds the address a Vite server prints, through its colours", () => {
    const output =
      "  \u001b[32m\u001b[1mVITE\u001b[22m v7.1.0\u001b[39m  ready in 312 ms\n\n" +
      "  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n";
    expect(extractLocalServerUrls(output)).toEqual(["http://localhost:5173/"]);
  });

  it("opens servers bound to every interface on localhost and drops repeats", () => {
    const output = [
      "- Local:        http://0.0.0.0:3000",
      "- Network:      http://192.168.1.4:3000",
      "ready on http://127.0.0.1:8080/app, again http://127.0.0.1:8080/app.",
      "http://localhost:3000/",
    ].join("\n");
    expect(extractLocalServerUrls(output)).toEqual([
      "http://localhost:3000/",
      "http://127.0.0.1:8080/app",
    ]);
  });

  it("ignores remote hosts and addresses without a port", () => {
    expect(extractLocalServerUrls("see https://athas.dev and http://localhost/")).toEqual([]);
  });

  it("reads the port of local addresses only", () => {
    expect(getLocalServerPort("http://localhost:5173/app")).toBe(5173);
    expect(getLocalServerPort("http://app.localhost:4321/")).toBe(4321);
    expect(getLocalServerPort("https://athas.dev")).toBeNull();
    expect(getLocalServerPort("about:blank")).toBeNull();
  });

  it("collects the text of nested tool output", () => {
    const output = [
      { type: "content", content: { type: "text", text: "Local: http://localhost:4000" } },
    ];
    expect(extractLocalServerUrls(collectText([output, { stdout: "ok" }]))).toEqual([
      "http://localhost:4000/",
    ]);
  });
});
