import type { AgentEvent } from "../core/types.js";

export type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;

/** Narrow an event by position, failing the test loudly when the shape is wrong. */
export function eventAt<T extends AgentEvent["type"]>(
  events: AgentEvent[],
  index: number,
  type: T,
): EventOf<T> {
  const event = events[index];
  if (event === undefined || event.type !== type) {
    throw new Error(`expected a "${type}" event at ${index}, got "${event?.type ?? "none"}"`);
  }
  return event as EventOf<T>;
}

/** Narrow the first event of a kind, failing the test loudly when it is missing. */
export function firstEvent<T extends AgentEvent["type"]>(
  events: AgentEvent[],
  type: T,
): EventOf<T> {
  const event = events.find((candidate) => candidate.type === type);
  if (event === undefined) throw new Error(`no "${type}" event in the stream`);
  return event as EventOf<T>;
}

export function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  return (async () => {
    const items: T[] = [];
    for await (const item of iterable) items.push(item);
    return items;
  })();
}
