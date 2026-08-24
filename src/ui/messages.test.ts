import { describe, expect, it } from "vitest";
import { messages } from "./messages.js";
import { badge, theme } from "./theme.js";

describe("identity guardrails", () => {
  it("carries the non-affiliation disclaimer verbatim (UX-SPEC.md)", () => {
    expect(messages.disclaimer).toBe(
      "Baton is an independent open-source project, not affiliated with or endorsed by " +
        "Anthropic, OpenAI, or Google. It orchestrates the official CLIs you installed and " +
        "authenticated yourself.",
    );
  });

  it("uses the fixed tagline", () => {
    expect(messages.tagline).toBe("Pass the baton, keep the context.");
  });

  it("renders agent badges lowercase and bracketed", () => {
    for (const id of ["claude", "codex", "gemini"]) {
      // eslint-disable-next-line no-control-regex -- stripping ANSI is the point here
      expect(badge(id).replace(/\x1b\[[0-9;]*m/g, "")).toBe(`[${id}]`);
    }
  });

  it("never paints anything orange", () => {
    const painted = Object.values(theme)
      .map((paint) => paint("x"))
      .join("");
    // 33 = yellow (allowed as warning), 208/214/166 = the orange family (forbidden).
    expect(painted).not.toMatch(/38;5;(166|172|202|208|214)/);
  });
});
