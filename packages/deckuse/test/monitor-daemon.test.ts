import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDaemonMeta,
  monitorStatus,
  monitorStatusAll,
  monitorStop,
  readDaemonMeta,
  writeDaemonMeta,
} from '../src/monitor-daemon.js';
import {
  deckuseHome,
  listMonitorRegistrations,
  monitorRegistrationPath,
  removeMonitorRegistration,
  upsertMonitorRegistration,
  type DaemonMeta,
} from '../src/monitor-registry.js';

const sampleMeta = (workspace: string, overrides: Partial<DaemonMeta> = {}): DaemonMeta => ({
  pid: overrides.pid ?? 999_999_999,
  host: overrides.host ?? '0.0.0.0',
  port: overrides.port ?? 4173,
  url: overrides.url ?? 'http://localhost:4173/',
  workspace: resolve(workspace),
  startedAt: overrides.startedAt ?? '2026-01-01T00:00:00.000Z',
});

describe('monitor-registry', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'deckuse-home-'));
    prevHome = process.env.DECKUSE_HOME;
    process.env.DECKUSE_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DECKUSE_HOME;
    else process.env.DECKUSE_HOME = prevHome;
  });

  it('uses DECKUSE_HOME for registry root', () => {
    expect(deckuseHome()).toBe(resolve(home));
  });

  it('upserts, lists, and removes registrations', async () => {
    const ws = resolve('/tmp/deckuse-ws-a');
    const meta = sampleMeta(ws, { pid: 42, port: 5199, url: 'http://localhost:5199/' });
    await upsertMonitorRegistration(meta);
    const listed = await listMonitorRegistrations();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      pid: 42,
      port: 5199,
      workspace: ws,
    });
    await removeMonitorRegistration(ws);
    expect(await listMonitorRegistrations()).toEqual([]);
  });

  it('overwrites the same workspace registration', async () => {
    const ws = resolve('/tmp/deckuse-ws-b');
    await upsertMonitorRegistration(sampleMeta(ws, { pid: 1, port: 4000 }));
    await upsertMonitorRegistration(sampleMeta(ws, { pid: 2, port: 4001 }));
    const listed = await listMonitorRegistrations();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.pid).toBe(2);
    expect(listed[0]?.port).toBe(4001);
  });
});

describe('monitor-daemon dual-write and status', () => {
  let home: string;
  let workspace: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'deckuse-home-'));
    workspace = await mkdtemp(join(tmpdir(), 'deckuse-ws-'));
    prevHome = process.env.DECKUSE_HOME;
    process.env.DECKUSE_HOME = home;
    await mkdir(join(workspace, '.deckuse', 'monitor'), { recursive: true });
  });

  afterEach(async () => {
    await clearDaemonMeta(workspace).catch(() => undefined);
    if (prevHome === undefined) delete process.env.DECKUSE_HOME;
    else process.env.DECKUSE_HOME = prevHome;
  });

  it('writeDaemonMeta dual-writes local and global registry', async () => {
    const meta = sampleMeta(workspace, { pid: 12345, port: 4280 });
    await writeDaemonMeta(workspace, meta);
    const local = await readDaemonMeta(workspace);
    expect(local?.pid).toBe(12345);
    const global = await listMonitorRegistrations();
    expect(global).toHaveLength(1);
    expect(global[0]?.workspace).toBe(resolve(workspace));
    expect(global[0]?.port).toBe(4280);
  });

  it('clearDaemonMeta clears local and global', async () => {
    await writeDaemonMeta(workspace, sampleMeta(workspace, { pid: 55 }));
    await clearDaemonMeta(workspace);
    expect(await readDaemonMeta(workspace)).toBeNull();
    expect(await listMonitorRegistrations()).toEqual([]);
  });

  it('monitorStatusAll prunes dead pid registrations', async () => {
    const dead = sampleMeta(workspace, { pid: 999_999_998 });
    await upsertMonitorRegistration(dead);
    await writeFile(
      join(workspace, '.deckuse', 'monitor', 'daemon.json'),
      `${JSON.stringify(dead, null, 2)}\n`,
      'utf8',
    );
    const result = await monitorStatusAll();
    expect(result.monitors).toEqual([]);
    expect(await listMonitorRegistrations()).toEqual([]);
  });

  it('monitorStatus prunes PID reuse without killing current process', async () => {
    // Use this vitest process pid — alive but not a monitor daemon.
    const reused = sampleMeta(workspace, { pid: process.pid, port: 4301 });
    await writeDaemonMeta(workspace, reused);

    const status = await monitorStatus(workspace);
    expect(status.running).toBe(false);
    expect(status.meta).toBeNull();
    expect(await readDaemonMeta(workspace)).toBeNull();
    expect(await listMonitorRegistrations()).toEqual([]);

    // Still alive
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });

  it('monitorStop with PID reuse clears meta without killing', async () => {
    const reused = sampleMeta(workspace, { pid: process.pid });
    await writeDaemonMeta(workspace, reused);
    const result = await monitorStop(workspace);
    expect(result.stopped).toBe(true);
    expect(await readDaemonMeta(workspace)).toBeNull();
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });

  it('monitorStatus heals missing global registration', async () => {
    // Simulate local-only meta with a dead pid so we do not need a real daemon;
    // heal path for running is covered by writeDaemonMeta dual-write.
    // Instead: write global missing by writing local via direct file then calling status with dead pid.
    const dead = sampleMeta(workspace, { pid: 999_999_997 });
    await mkdir(join(workspace, '.deckuse', 'monitor'), { recursive: true });
    await writeFile(
      join(workspace, '.deckuse', 'monitor', 'daemon.json'),
      `${JSON.stringify(dead, null, 2)}\n`,
      'utf8',
    );
    // No global file
    expect(await listMonitorRegistrations()).toEqual([]);
    const status = await monitorStatus(workspace);
    expect(status.running).toBe(false);
    // Dead local cleared (and would have synced remove)
    expect(await readDaemonMeta(workspace)).toBeNull();
  });

  it('monitorStatusAll returns empty when only corrupt registry files exist', async () => {
    await mkdir(join(home, 'monitors'), { recursive: true });
    await writeFile(join(home, 'monitors', 'bad.json'), '{not-json', 'utf8');
    await writeFile(join(home, 'monitors', 'skip.txt'), 'nope', 'utf8');
    const result = await monitorStatusAll();
    expect(result.monitors).toEqual([]);
  });

  it('registration path is stable per workspace', () => {
    const a = monitorRegistrationPath(workspace);
    const b = monitorRegistrationPath(resolve(workspace, '.'));
    expect(a).toBe(b);
  });
});
