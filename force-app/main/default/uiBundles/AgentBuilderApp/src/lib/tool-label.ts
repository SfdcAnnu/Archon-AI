/**
 * A tool's name as a person should read it: no ask_ or handoff_to_ prefix,
 * no trailing node id, no underscores.
 *
 * One definition, because two places show it — the live indicator while a
 * turn runs, and the result cards once it lands — and a reader who sees a
 * call named one thing mid-turn and another thing afterwards has no way to
 * know they were the same call.
 */
export function toolLabel(name: string): string {
  return name
    .replace(/^(ask|handoff_to)_/, '')
    .replace(/_[a-z0-9]{6}$/, '')
    .replace(/_/g, ' ');
}
