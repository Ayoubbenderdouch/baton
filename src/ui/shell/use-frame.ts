import { useEffect, useState } from "react";
import { subscribeToFrames } from "../animation.js";

/**
 * Re-render on the shared 10fps clock — and only while something is actually animating,
 * so an idle screen costs nothing (docs/UX-SPEC.md, performance rules).
 */
export function useFrame(active: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    return subscribeToFrames((next) => setFrame(next));
  }, [active]);
  return frame;
}

/** Terminal width, kept current across resizes. */
export function useColumns(): number {
  const [columns, setColumns] = useState(process.stdout.columns ?? 80);
  useEffect(() => {
    const onResize = (): void => setColumns(process.stdout.columns ?? 80);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);
  return columns;
}
