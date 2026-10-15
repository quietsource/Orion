/**
 * Per-turn focus cadence for workspace agent runs.
 *
 * Ticks never interrupt inference or tool execution. They only mark a reminder
 * due; the agent consumes it at the next model-call boundary where the
 * original request, Orion instructions, and recent tool results are rebuilt.
 */
export type FocusCheckpoint = {
  reason: 'time' | 'work';
  elapsedMs: number;
  actionsSinceCheckpoint: number;
};

export interface FocusCadence {
  recordAction(): void;
  takeCheckpoint(): FocusCheckpoint | null;
  stop(): void;
}

const TICK_MS = 15_000;
const CHECKPOINT_INTERVAL_MS = 2 * 60_000;
const ACTIONS_PER_CHECKPOINT = 5;

export function createFocusCadence(enabled: boolean, now: () => number = Date.now): FocusCadence {
  if (!enabled) return { recordAction() {}, takeCheckpoint: () => null, stop() {} };

  const startedAt = now();
  let lastCheckpointAt = startedAt;
  let actionsSinceCheckpoint = 0;
  let timeCheckpointDue = false;
  const timer = setInterval(() => {
    if (now() - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) timeCheckpointDue = true;
  }, TICK_MS);
  timer.unref?.();

  return {
    recordAction() {
      actionsSinceCheckpoint++;
    },
    takeCheckpoint() {
      const elapsedMs = now() - lastCheckpointAt;
      if (!timeCheckpointDue && actionsSinceCheckpoint < ACTIONS_PER_CHECKPOINT) return null;
      const checkpoint: FocusCheckpoint = {
        reason: timeCheckpointDue ? 'time' : 'work',
        elapsedMs,
        actionsSinceCheckpoint,
      };
      lastCheckpointAt = now();
      actionsSinceCheckpoint = 0;
      timeCheckpointDue = false;
      return checkpoint;
    },
    stop() {
      clearInterval(timer);
    },
  };
}
