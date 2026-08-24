// eslint-disable-next-line no-control-regex -- measuring visible width means removing ANSI
const ANSI = /\x1b\[[0-9;]*m/g;

export function visibleWidth(text: string): number {
  return text.replace(ANSI, "").length;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

/**
 * Left-aligned columns padded by VISIBLE width, so colored cells still line up.
 * Alignment never depends on emoji width (docs/CROSS-PLATFORM.md).
 */
export function formatTable(headers: string[], rows: string[][], gap = 2): string {
  const widths = headers.map((header, column) =>
    Math.max(visibleWidth(header), ...rows.map((row) => visibleWidth(row[column] ?? ""))),
  );
  const spacer = " ".repeat(gap);
  const lines = [
    headers.map((header, i) => pad(header, widths[i] ?? 0)).join(spacer).trimEnd(),
    ...rows.map((row) =>
      row
        .map((cell, i) => pad(cell, widths[i] ?? 0))
        .join(spacer)
        .trimEnd(),
    ),
  ];
  return lines.join("\n");
}
