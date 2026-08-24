/**
 * A consumer that closes the pipe — `baton status | head`, `baton --help | less` and
 * then `q` — makes Node emit EPIPE on stdout. That is not an error the user did
 * anything wrong with, and it must never surface as a stack trace (docs/UX-SPEC.md).
 */
export function installPipeGuards(
  streams: NodeJS.EventEmitter[] = [process.stdout, process.stderr],
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  for (const stream of streams) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        exit(0);
        return;
      }
      throw error;
    });
  }
}
