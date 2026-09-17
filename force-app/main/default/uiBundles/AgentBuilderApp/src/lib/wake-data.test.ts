import { describe, expect, it, vi } from 'vitest';

// The real transport needs a Salesforce host frame; the loop is exercised via fetchOnce.
vi.mock('./apex-client', () => ({ apexFetch: vi.fn() }));
import { isAllOnline, isSettled, wakeUntilSettled, type WakeResult, type WakeStatus } from './wake-data';

function result(archon: WakeStatus, ...targets: WakeStatus[]): WakeResult {
  return {
    configured: true,
    archon: { key: 'archon', name: 'Archon server', url: 'https://a.example', status: archon, ms: 1, message: null },
    targets: targets.map((status, i) => ({
      key: `t${i}`,
      name: `MCP ${i}`,
      url: `https://mcp${i}.example`,
      status,
      ms: null,
      message: null,
    })),
  };
}

const noSleep = () => Promise.resolve();

describe('isSettled / isAllOnline', () => {
  it('waking or pending anywhere keeps the loop going', () => {
    expect(isSettled(result('online', 'waking'))).toBe(false);
    expect(isSettled(result('waking'))).toBe(false);
    expect(isSettled(result('online', 'pending'))).toBe(false);
  });
  it('online + unreachable is settled but not all online', () => {
    const r = result('online', 'online', 'unreachable');
    expect(isSettled(r)).toBe(true);
    expect(isAllOnline(r)).toBe(false);
    expect(isAllOnline(result('online', 'online'))).toBe(true);
  });
});

describe('wakeUntilSettled', () => {
  it('polls until every service is online, reporting each probe', async () => {
    const probes = [result('waking'), result('online', 'waking', 'pending'), result('online', 'online', 'online')];
    const seen: WakeResult[] = [];
    const outcome = await wakeUntilSettled({
      onUpdate: r => seen.push(r),
      sleep: noSleep,
      fetchOnce: async () => probes.shift()!,
    });
    expect(outcome).toBe('ready');
    expect(seen).toHaveLength(3);
  });

  it('reports partial when something stays unreachable', async () => {
    const outcome = await wakeUntilSettled({
      onUpdate: () => {},
      sleep: noSleep,
      fetchOnce: async () => result('online', 'unreachable'),
    });
    expect(outcome).toBe('partial');
  });

  it('gives up after the budget and says so', async () => {
    let clock = 0;
    const outcome = await wakeUntilSettled({
      onUpdate: () => {},
      maxMs: 20000,
      intervalMs: 5000,
      now: () => clock,
      sleep: async ms => {
        clock += ms;
      },
      fetchOnce: async () => result('waking'),
    });
    expect(outcome).toBe('timeout');
  });

  it('keeps polling through a client-side timeout but surfaces real errors', async () => {
    const answers: Array<() => Promise<WakeResult>> = [
      () => Promise.reject(new Error('Apex REST call timed out after 70000ms')),
      () => Promise.resolve(result('online')),
    ];
    await expect(
      wakeUntilSettled({ onUpdate: () => {}, sleep: noSleep, fetchOnce: () => answers.shift()!() })
    ).resolves.toBe('ready');

    await expect(
      wakeUntilSettled({
        onUpdate: () => {},
        sleep: noSleep,
        fetchOnce: () => Promise.reject(new Error('Synapse Config ServerUrl__c is not set.')),
      })
    ).rejects.toThrow(/ServerUrl__c/);
  });

  it('stops quietly when cancelled', async () => {
    let cancelled = false;
    const outcome = await wakeUntilSettled({
      onUpdate: () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
      sleep: noSleep,
      fetchOnce: async () => result('waking'),
    });
    expect(outcome).toBe('cancelled');
  });
});
