import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderConfigReference } from "./config-docs.js";

const file = path.join(process.cwd(), "docs", "CONFIG.md");

describe("docs/CONFIG.md", () => {
  it("matches the zod schema it is generated from", () => {
    const generated = renderConfigReference();
    // BATON_UPDATE_DOCS=1 npm test regenerates the file after a deliberate change.
    if (process.env.BATON_UPDATE_DOCS === "1") {
      writeFileSync(file, generated, "utf8");
    }
    let current: string;
    try {
      current = readFileSync(file, "utf8");
    } catch {
      current = "(docs/CONFIG.md is missing)";
    }
    // Compare line-ending neutral: a Windows checkout may hand us CRLF whatever
    // .gitattributes says (docs/TESTING.md - normalize before comparing).
    const normalize = (text: string): string => text.replace(/\r\n/g, "\n");
    expect(
      normalize(current),
      "docs/CONFIG.md is out of date — run `BATON_UPDATE_DOCS=1 npm test`",
    ).toBe(normalize(generated));
  });
});
