import stringWidth from "string-width";

/**
 * Visible width of a string in terminal cells: CJK counts 2, combining marks and
 * zero-width joiners count 0, emoji count what the terminal actually gives them.
 * Every layout decision goes through here — never `.length`.
 */
export function width(text: string): number {
  return stringWidth(text);
}

export function padEnd(text: string, target: number): string {
  const missing = target - width(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

export function padStart(text: string, target: number): string {
  const missing = target - width(text);
  return missing > 0 ? " ".repeat(missing) + text : text;
}

/** Cut from the end, keeping the result within `max` cells. */
export function truncateEnd(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (width(text) <= max) return text;
  const room = Math.max(0, max - width(ellipsis));
  let out = "";
  for (const char of text) {
    if (width(out + char) > room) break;
    out += char;
  }
  return out + ellipsis;
}

/**
 * Cut out of the middle — the right way to shorten a path, because the folder you are
 * in matters as much as the root it hangs off.
 */
export function truncateMiddle(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (width(text) <= max) return text;
  const room = max - width(ellipsis);
  if (room <= 0) return ellipsis;
  const headRoom = Math.ceil(room / 2);
  const tailRoom = room - headRoom;

  let head = "";
  for (const char of text) {
    if (width(head + char) > headRoom) break;
    head += char;
  }
  let tail = "";
  for (const char of [...text].reverse()) {
    if (width(char + tail) > tailRoom) break;
    tail = char + tail;
  }
  return `${head}${ellipsis}${tail}`;
}

/** Wrap on word boundaries, measured in cells rather than characters. */
export function wrap(text: string, max: number): string[] {
  if (max <= 0) return [text];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter((part) => part !== "")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (width(candidate) <= max) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      current = width(word) <= max ? word : truncateEnd(word, max);
    }
    lines.push(current);
  }
  return lines;
}
