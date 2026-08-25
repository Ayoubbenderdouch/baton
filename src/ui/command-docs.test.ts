import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCommandTable } from "./command-docs.js";

const file = path.join(process.cwd(), "docs", "UX-SPEC.md");
const START = "<!-- generated from src/ui/commands.ts";

describe("the command table in docs/UX-SPEC.md", () => {
  it("matches the registry it is generated from", () => {
    const generated = renderCommandTable();
    const current = readFileSync(file, "utf8");

    if (process.env.BATON_UPDATE_DOCS === "1") {
      const start = current.indexOf(START);
      const marker = "<!--COMMAND-TABLE-->";
      const next =
        start === -1
          ? current.replace(marker, generated)
          : `${current.slice(0, start)}${generated}${current.slice(current.indexOf("\n\n### `/login`", start))}`;
      writeFileSync(file, next, "utf8");
      return;
    }

    const start = current.indexOf(START);
    expect(start, "the generated table is missing — run `BATON_UPDATE_DOCS=1 npm test`").toBeGreaterThan(-1);
    const section = current.slice(start, current.indexOf("\n\n### `/login`", start));
    expect(section.replace(/\r\n/g, "\n").trim()).toBe(generated.trim());
  });
});
