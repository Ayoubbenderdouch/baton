import { glyphs } from "./glyphs.js";
import { paint } from "./theme.js";
import { wrap } from "./width.js";

/**
 * A small markdown renderer for assistant prose: bold, italic, inline code, bullets,
 * headings, and fenced code blocks with light syntax colouring.
 *
 * Hand-rolled on purpose. A full markdown + highlighter stack would add a large
 * dependency tree to a tool whose selling point is that it has almost none, and agent
 * output uses a narrow slice of markdown anyway. Unknown syntax degrades to plain text
 * rather than to noise.
 */

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "class",
  "import", "export", "from", "await", "async", "new", "try", "catch", "finally",
  "throw", "typeof", "interface", "type", "extends", "implements", "def", "elif",
  "lambda", "None", "True", "False", "null", "true", "false", "undefined", "echo",
  "fi", "then", "do", "done", "case", "esac", "local", "public", "private", "static",
]);

function highlightCode(line: string): string {
  const comment = /^(\s*)(\/\/|#).*$/.exec(line);
  if (comment) return paint.dim(line);

  return line.replace(
    /(".*?"|'.*?'|`.*?`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b/g,
    (match, string: string | undefined, num: string | undefined, word: string | undefined) => {
      if (string !== undefined) return paint.success(match);
      if (num !== undefined) return paint.accent(match);
      if (word !== undefined && KEYWORDS.has(word)) return paint.primary(match);
      return match;
    },
  );
}

/** `**bold**`, `*italic*`, `` `code` `` — applied without nesting bold inside dim. */
export function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_match, code: string) => paint.accent(code))
    .replace(/\*\*([^*]+)\*\*/g, (_match, bold: string) => paint.bold(bold))
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_match, italic: string) => paint.bold(italic))
    .replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, (_m, i: string) => paint.bold(i));
}

export function renderMarkdown(text: string, columns: number): string[] {
  const g = glyphs();
  const out: string[] = [];
  const room = Math.max(20, columns - 2);
  let inCode = false;

  for (const raw of text.split(/\r?\n/)) {
    const fence = /^\s*```/.test(raw);
    if (fence) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${paint.dim(g.bar)} ${highlightCode(raw)}`);
      continue;
    }
    if (raw.trim() === "") {
      out.push("");
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      out.push(paint.bold(renderInline(heading[2] ?? "")));
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (bullet) {
      const lines = wrap(bullet[1] ?? "", room - 2);
      lines.forEach((line, index) => {
        out.push(index === 0 ? `  ${paint.dim("·")} ${renderInline(line)}` : `    ${renderInline(line)}`);
      });
      continue;
    }
    for (const line of wrap(raw.trim(), room)) out.push(renderInline(line));
  }

  // Collapse the runs of blank lines markdown loves to produce.
  return out.filter((line, index) => line !== "" || (out[index - 1] ?? "") !== "");
}
