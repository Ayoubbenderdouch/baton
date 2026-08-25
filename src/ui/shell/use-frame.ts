import { useEffect, useState } from "react";
import { useStdout } from "ink";
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

/**
 * Terminal width, kept current across resizes.
 *
 * Read from Ink's own stdout rather than `process.stdout`: they are the same object in a
 * real terminal, but not under a test renderer — and a layout measured against the wrong
 * one draws rules and padding that do not line up with the frame.
 */
export function useColumns(): number {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout.columns ?? 80);
  useEffect(() => {
    const onResize = (): void => setColumns(stdout.columns ?? 80);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return columns;
}
