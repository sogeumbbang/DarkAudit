import { useEffect, useState } from "react";
import type { ExplorationEventDto } from "@/entities/audit/types";

function entryFrame(events: ExplorationEventDto[]) {
  const latest = events.at(-1);
  // A poll can contain actions, their results and the capture-complete event.
  // Show recent actions even if the server has already moved on to analysis.
  return events.slice(-8).find((event) => event.kind === "action") ?? latest;
}

export function useExplorationPlayback(events: ExplorationEventDto[], running: boolean) {
  const [selectedId, setSelectedId] = useState<number>();
  const [cursor, setCursor] = useState(() => entryFrame(events)?.id);
  const latest = events.at(-1);
  const selected = events.find((event) => event.id === selectedId);
  const following = !selected;
  // Bound playback lag after a background tab resumes or a large batch arrives.
  const recent = events.slice(-12);
  const current = recent.find((event) => event.id === cursor) ?? entryFrame(recent);
  const frame = selected ?? (running ? current : latest);
  const next = recent.find((event) => event.id > (current?.id ?? 0));
  const nextId = next?.id ?? current?.id;
  const delay = !next ? 0 : current?.kind === "action" ? 1100 : 450;

  useEffect(() => {
    if (!running || !following || nextId == null || nextId === cursor) return;
    const timer = window.setTimeout(() => setCursor(nextId), delay);
    return () => window.clearTimeout(timer);
  }, [running, following, nextId, cursor, delay]);

  return {
    frame,
    following,
    catchingUp: following && frame?.id !== latest?.id,
    select: setSelectedId,
    follow: () => {
      setCursor(latest?.id);
      setSelectedId(undefined);
    },
  };
}
