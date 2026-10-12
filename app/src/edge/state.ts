import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SLOTS = Object.freeze({ blue: { gateway: 18174, web: 18172 }, green: { gateway: 18175, web: 18173 } });
export type Slot = keyof typeof SLOTS;
export type EdgeState = { active: Slot; generation: number; commit: string };
export const stateRoot = () => join(homedir(), '.local/share/blog-observe/edge');
export function slotOf(value: unknown): Slot {
  if (value !== 'blue' && value !== 'green') throw Error('invalid_slot');
  return value;
}
export function parseState(raw: string): EdgeState {
  const value = JSON.parse(raw);
  if (!value || Object.keys(value).sort().join(',') !== 'active,commit,generation') throw Error('invalid_edge_state');
  const active = slotOf(value.active);
  if (!Number.isSafeInteger(value.generation) || value.generation < 1 || !/^[a-f0-9]{40}$/.test(value.commit))
    throw Error('invalid_edge_state');
  return { active, generation: value.generation, commit: value.commit };
}

/** Only local operator state; neither request headers nor URL select a target. */
export class StateReader {
  private current: EdgeState | null = null;
  private pending: Promise<EdgeState> | null = null;
  private read: () => Promise<string>;
  constructor(path: string, read = () => readFile(path, 'utf8')) {
    this.read = read;
  }
  async get(): Promise<EdgeState> {
    if (this.pending) return this.pending;
    this.pending = this.refresh();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }
  private async refresh(): Promise<EdgeState> {
    try {
      const next = parseState(await this.read());
      if (!this.current || next.generation > this.current.generation) this.current = next;
      else if (JSON.stringify(next) !== JSON.stringify(this.current)) throw Error('stale_edge_state');
    } catch (error) {
      if (!this.current) throw error;
      // Invalid/partial/missing state must not evict the last known good target.
    }
    return this.current;
  }
}

/** Caller holds the host flock; same-directory rename is the switch boundary. */
export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.pending-${process.pid}-${Date.now()}`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export function socketFd(env: NodeJS.ProcessEnv, pid: number): number {
  if (env.LISTEN_PID !== String(pid) || env.LISTEN_FDS !== '1' || env.LISTEN_FDNAMES !== 'http')
    throw Error('one_systemd_http_socket_required');
  return 3;
}
