import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // ink and react are real dependencies, resolved at runtime: the shell is loaded only
  // when someone actually opens it, so `baton run "task"` never pays for React.
  external: ["ink", "react", "react/jsx-runtime"],
  splitting: true,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
});
