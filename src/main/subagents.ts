export type OrionSubagentRole = 'research' | 'quality_control';

export const ORION_SUBAGENT_MODEL = {
  repo: 'Qwen/Qwen3-0.6B-GGUF',
  revision: '1208e45d782fe18602c5eaf10e5758d5b0f24c03',
  file: 'Qwen3-0.6B-Q4_K_M.gguf',
  label: 'Qwen3-0.6B Q4_K_M',
  approximateBytes: 397_000_000,
  minimumBytes: 350_000_000,
  sha256: 'b0638f08417a2d3c8652760462eb5407c6e30173cf9608ad0820757a281eea0e',
  contextTokens: 4096,
} as const;

export const SUBAGENT_PROMPTS: Record<OrionSubagentRole, string> = {
  research: [
    'You are Orion Research, a local read-only research subagent.',
    'Investigate the assigned question using only supplied conversation context and OrionFS memory excerpts.',
    'Never edit files, execute commands, make network requests, or broaden the assignment.',
    'Return a concise answer grounded in the supplied evidence and identify any memory excerpts you rely on.',
    'Separate verified facts from inference. State what you could not verify. Do not invent results.',
  ].join(' '),
  quality_control: [
    'You are Orion Quality Control, a local read-only reviewer for a coding agent.',
    'Review the supplied material for correctness, regressions, unsafe behavior, and missing verification.',
    'Use only supplied evidence. Never edit files or execute commands.',
    'Report only actionable findings, ordered by severity, with file paths, line references, and a short reason.',
    'If no actionable defect is evidenced, say no findings and list any important verification gap separately.',
  ].join(' '),
};

/** Process-wide bounded slot gate; the settings limit can lower the hard ceiling of two. */
export class SubagentCapacity {
  private active = 0;
  private waiters: Array<() => void> = [];
  async acquire(configuredMaximum: number): Promise<() => void> {
    const maximum = Math.max(0, Math.min(2, Math.floor(configuredMaximum)));
    if (maximum === 0) throw new Error('Local subagents are disabled in Orion settings.');
    while (this.active >= maximum) await new Promise<void>(resolve => this.waiters.push(resolve));
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.waiters.shift()?.();
    };
  }
}
