import { describe, expect, it, vi } from "vitest";
import { createTerminalOutputBuffer } from "../utils/terminal-output-buffer";

describe("terminal output buffer", () => {
  it("coalesces a burst while preserving every byte in order", () => {
    const scheduled: Array<() => void> = [];
    const writes: Array<{ data: Uint8Array; done: () => void }> = [];
    const buffer = createTerminalOutputBuffer({
      schedule: (callback) => scheduled.push(callback),
      write: (data, done) => writes.push({ data, done }),
    });

    for (let index = 0; index < 1000; index += 1) {
      buffer.enqueue(Uint8Array.from({ length: 32 }, (_, offset) => (index + offset) & 0xff));
    }
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();

    expect(writes).toHaveLength(1);
    expect(writes[0]?.data.byteLength).toBe(32_000);
    expect(Array.from(writes[0]?.data.slice(0, 35) ?? [])).toEqual([
      ...Array.from({ length: 32 }, (_, offset) => offset),
      1,
      2,
      3,
    ]);
    writes[0]?.done();
    expect(buffer.queuedBytes()).toBe(0);
  });

  it("limits each xterm write and waits for its callback before the next write", () => {
    const writes: Array<{ data: Uint8Array; done: () => void }> = [];
    const buffer = createTerminalOutputBuffer({
      maxBatchBytes: 64,
      schedule: (callback) => callback(),
      write: (data, done) => writes.push({ data, done }),
    });

    buffer.enqueue(Uint8Array.from({ length: 150 }, (_, index) => index));
    expect(writes.map(({ data }) => data.byteLength)).toEqual([64]);
    writes[0]?.done();
    expect(writes.map(({ data }) => data.byteLength)).toEqual([64, 64]);
    writes[1]?.done();
    expect(writes.map(({ data }) => data.byteLength)).toEqual([64, 64, 22]);
    writes[2]?.done();
    expect(buffer.queuedBytes()).toBe(0);
  });

  it("resolves close draining after all output callbacks and recovers from write errors", async () => {
    let done: (() => void) | undefined;
    const buffer = createTerminalOutputBuffer({
      schedule: (callback) => callback(),
      write: (_data, callback) => {
        done = callback;
      },
    });
    buffer.enqueue(new Uint8Array([1, 2, 3]));
    const drained = vi.fn();
    void buffer.whenDrained().then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();
    done?.();
    await buffer.whenDrained();
    expect(drained).toHaveBeenCalledOnce();

    const onWriteError = vi.fn();
    const failed = createTerminalOutputBuffer({
      schedule: (callback) => callback(),
      write: () => {
        throw new Error("xterm disposed");
      },
      onWriteError,
    });
    failed.enqueue(new Uint8Array([4]));
    await failed.whenDrained();
    expect(onWriteError).toHaveBeenCalledOnce();
  });
});
