import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installPipeGuards } from "./streams.js";

describe("pipe guards", () => {
  it("exits quietly when the consumer closes the pipe (baton status | head)", () => {
    const stream = new EventEmitter();
    const exit = vi.fn();
    installPipeGuards([stream], exit);
    const epipe: NodeJS.ErrnoException = new Error("write EPIPE");
    epipe.code = "EPIPE";
    expect(() => stream.emit("error", epipe)).not.toThrow();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still lets a real write failure through", () => {
    const stream = new EventEmitter();
    const exit = vi.fn();
    installPipeGuards([stream], exit);
    const enospc: NodeJS.ErrnoException = new Error("no space left on device");
    enospc.code = "ENOSPC";
    expect(() => stream.emit("error", enospc)).toThrow("no space left on device");
    expect(exit).not.toHaveBeenCalled();
  });

  it("guards both stdout and stderr by default", () => {
    const before = process.stdout.listenerCount("error");
    installPipeGuards();
    expect(process.stdout.listenerCount("error")).toBe(before + 1);
    process.stdout.removeAllListeners("error");
    process.stderr.removeAllListeners("error");
  });
});
