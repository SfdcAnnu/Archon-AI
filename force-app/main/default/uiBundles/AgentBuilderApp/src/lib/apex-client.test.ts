import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('@salesforce/platform-sdk', () => ({
  createDataSDK: () => Promise.resolve({ fetch: fetchMock }),
}));

function reply(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}
const UNMAPPED = [{ errorCode: 'NOT_FOUND', message: 'Could not find a match for URL' }];

async function freshClient() {
  vi.resetModules();
  window.sessionStorage.clear();
  return import('./apex-client');
}

describe('apexFetch namespace handling', () => {
  beforeEach(() => fetchMock.mockReset());

  it('uses the packaged path and strips archon__ keys in a namespaced org', async () => {
    const { apexFetch } = await freshClient();
    fetchMock.mockReturnValueOnce(
      reply(200, { session: { Id: 'a1', archon__Title__c: 'Hi', archon__AgentDefinition__r: { Name: 'Bot' } } })
    );
    const body = await apexFetch<{ session: Record<string, unknown> }>('/services/apexrest/agent-builder/chat/x');
    expect(fetchMock.mock.calls[0][0]).toBe('/services/apexrest/archon/agent-builder/chat/x');
    expect(body.session).toEqual({ Id: 'a1', Title__c: 'Hi', AgentDefinition__r: { Name: 'Bot' } });

    fetchMock.mockReturnValueOnce(reply(200, { records: [{ archon__Status__c: 'OK' }] }));
    const next = await apexFetch<{ records: unknown[] }>('/services/apexrest/agent-builder/agents');
    expect(fetchMock.mock.calls[1][0]).toBe('/services/apexrest/archon/agent-builder/agents');
    expect(next.records).toEqual([{ Status__c: 'OK' }]);
  });

  it('falls back to the plain path once, then remembers it, in an org without the namespace', async () => {
    const { apexFetch } = await freshClient();
    fetchMock.mockReturnValueOnce(reply(404, UNMAPPED)).mockReturnValueOnce(reply(200, { Title__c: 'x' }));
    expect(await apexFetch('/services/apexrest/agent-builder/agents')).toEqual({ Title__c: 'x' });
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/services/apexrest/archon/agent-builder/agents',
      '/services/apexrest/agent-builder/agents',
    ]);

    fetchMock.mockReturnValueOnce(reply(200, { archon__Keep__c: 1 }));
    expect(await apexFetch('/services/apexrest/agent-builder/agents')).toEqual({ archon__Keep__c: 1 });
    expect(fetchMock.mock.calls[2][0]).toBe('/services/apexrest/agent-builder/agents');
  });

  it('still surfaces an ordinary error body', async () => {
    const { apexFetch } = await freshClient();
    fetchMock.mockReturnValueOnce(reply(400, { error: 'Agent not found' }));
    await expect(apexFetch('/services/apexrest/agent-builder/agent/x')).rejects.toThrow('Agent not found');
  });
});
