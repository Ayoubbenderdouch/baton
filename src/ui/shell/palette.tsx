import React from "react";
import { Box, Text } from "ink";
import type { CommandDef } from "../commands.js";
import { glyphs } from "../glyphs.js";
import { messages } from "../messages.js";
import { paint, palette as colors } from "../theme.js";
import { padEnd, truncateEnd, width } from "../width.js";

export const MAX_VISIBLE_ROWS = 7;

/** Which slice of the list to show so the selected row stays on screen. */
export function visibleWindow(total: number, selected: number, size = MAX_VISIBLE_ROWS): [number, number] {
  if (total <= size) return [0, total];
  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(0, selected - half), total - size);
  return [start, start + size];
}

export function rowText(command: CommandDef, nameWidth: number, columns: number): string {
  const g = glyphs();
  const name = `/${command.id}`;
  const room = columns - nameWidth - 8;
  const description = truncateEnd(command.description, Math.max(10, room), g.ellipsis);
  return `${padEnd(name, nameWidth)}  ${description}`;
}

/**
 * The command palette, attached under the input line inside the same frame — so the
 * input never floats loose while you are choosing (docs/UX-SPEC.md).
 */
export function Palette({
  value,
  commands,
  selected,
  columns,
}: {
  value: string;
  commands: CommandDef[];
  selected: number;
  columns: number;
}): React.ReactElement {
  const g = glyphs();
  const inner = Math.max(20, columns - 4);
  const [start, end] = visibleWindow(commands.length, selected);
  const shown = commands.slice(start, end);
  const nameWidth = Math.max(...commands.map((command) => width(`/${command.id}`)), 8);

  return (
    <Box
      flexDirection="column"
      borderStyle={g.border === "classic" ? "classic" : "round"}
      borderColor={colors.primary}
      paddingX={1}
    >
      <Text>
        {paint.accent(`${g.caret} `)}
        {value}
      </Text>
      <Text>{paint.dim(g.rule.repeat(inner))}</Text>
      {shown.length === 0 ? (
        <Text>{paint.dim(messages.unknownCommand(value.replace(/^\//, "")))}</Text>
      ) : (
        shown.map((command, index) => {
          const isSelected = start + index === selected;
          const row = rowText(command, nameWidth, inner);
          return (
            <Text key={command.id}>
              {isSelected ? paint.primary(`${g.caret} `) : "  "}
              {isSelected ? paint.bold(row) : paint.dim(row)}
            </Text>
          );
        })
      )}
      {commands.length > shown.length && (
        <Text>{paint.dim(`… ${commands.length - shown.length} more`)}</Text>
      )}
      <Text>{paint.dim(messages.paletteHint)}</Text>
    </Box>
  );
}
