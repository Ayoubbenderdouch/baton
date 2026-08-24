/**
 * Line splitting for provider output.
 *
 * JSONL from any provider may arrive with `\r\n` (docs/CROSS-PLATFORM.md), and chunks
 * split anywhere — including in the middle of a multi-byte character, which is why the
 * decoding happens here with an explicit utf8 decoder rather than per chunk.
 */
export async function* toLines(
  source: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf8");
  let buffer = "";
  for await (const chunk of source) {
    buffer +=
      typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      yield stripCarriageReturn(line);
      index = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) yield stripCarriageReturn(buffer);
}

export function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Split a whole captured blob the same way (used by fixture-driven tests). */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}
