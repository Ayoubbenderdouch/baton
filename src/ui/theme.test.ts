import { describe, expect, it } from "vitest";
import { agentColors, palette } from "./theme.js";

/** Hue in degrees, plus saturation, from a #rrggbb string. */
function hsl(hex: string): { hue: number; saturation: number } {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation };
}

describe("identity guardrail: no orange, ever", () => {
  const tokens = { ...palette, ...agentColors };

  it.each(Object.entries(tokens))("%s is not in the orange family", (name, hex) => {
    const { hue, saturation } = hsl(hex);
    // Orange spans roughly 15°–45°. A washed-out colour there is fine; a saturated one
    // is what reads as Claude Code's palette, and that is what this forbids.
    const isOrange = hue >= 15 && hue < 45 && saturation > 0.35;
    expect(isOrange, `${name} (${hex}) has hue ${hue.toFixed(1)}°`).toBe(false);
  });

  it("keeps violet as the primary and cyan as the accent", () => {
    expect(hsl(palette.primary).hue).toBeGreaterThan(240);
    expect(hsl(palette.primary).hue).toBeLessThan(280);
    expect(hsl(palette.accent).hue).toBeGreaterThan(170);
    expect(hsl(palette.accent).hue).toBeLessThan(200);
  });

  it("gives every agent its own colour", () => {
    const values = Object.values(agentColors);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("no colour literals outside the theme", () => {
  it("keeps hex colours out of the components", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const roots = ["src/ui", "src/ui/components", "src/ui/shell"];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of readdirSync(root, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        if (!/\.(ts|tsx)$/.test(file.name)) continue;
        if (file.name.startsWith("theme.")) continue;
        const contents = readFileSync(path.join(root, file.name), "utf8");
        if (/#[0-9a-fA-F]{6}\b/.test(contents)) offenders.push(`${root}/${file.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
