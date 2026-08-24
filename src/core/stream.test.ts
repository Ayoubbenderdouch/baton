import { describe, expect, it } from "vitest";
import { splitLines, stripCarriageReturn, toLines } from "./stream.js";

async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<string | Uint8Array> {
  for (const part of parts) yield part;
}

async function lines(source: AsyncIterable<string | Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of toLines(source)) out.push(line);
  return out;
}

describe("line splitting", () => {
  it("handles LF, CRLF and a missing final newline", async () => {
    expect(await lines(chunks("a\nb\r\nc"))).toEqual(["a", "b", "c"]);
  });

  it("reassembles lines split across chunks", async () => {
    expect(await lines(chunks('{"ty', 'pe":"text"}\n{"x"', ":1}\n"))).toEqual([
      '{"type":"text"}',
      '{"x":1}',
    ]);
  });

  it("survives a multi-byte character split across two chunks", async () => {
    const encoded = new TextEncoder().encode("مرحبا 👋\n");
    const cut = 4;
    const result = await lines(chunks(encoded.slice(0, cut), encoded.slice(cut)));
    expect(result).toEqual(["مرحبا 👋"]);
  });

  it("drops the trailing carriage return, not inner ones", () => {
    expect(stripCarriageReturn("a\r")).toBe("a");
    expect(stripCarriageReturn("a\rb")).toBe("a\rb");
  });

  it("splitLines ignores blank lines", () => {
    expect(splitLines("a\r\n\nb\n")).toEqual(["a", "b"]);
  });
});
