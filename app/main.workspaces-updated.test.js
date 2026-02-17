import { describe, expect, test, vi } from 'vitest';
import { bootstrap } from './main.js';

/** @type {Record<string, (payload: any) => void>} */
const handlers = {};
/** @type {Array<{ type: string, payload: unknown }>} */
const sent = [];

vi.mock('./ws.js', () => ({
  createWsClient: () => ({
    /**
     * @param {string} type
     * @param {unknown} payload
     */
    async send(type, payload) {
      sent.push({ type, payload });
      if (type === 'list-workspaces') {
        return {
          workspaces: [
            {
              path: '/workspace-a',
              database: '/workspace-a/.beads/bd.db',
              pid: 11,
              version: 'x'
            }
          ],
          current: {
            root_dir: '/workspace-a',
            db_path: '/workspace-a/.beads/bd.db'
          }
        };
      }
      return null;
    },
    /**
     * @param {string} type
     * @param {(payload: any) => void} handler
     */
    on(type, handler) {
      handlers[type] = handler;
      return () => {
        delete handlers[type];
      };
    },
    onConnection() {
      return () => {};
    },
    close() {},
    getState() {
      return 'open';
    }
  })
}));

describe('workspace list updates', () => {
  test('reloads workspace list once for a burst of workspaces-updated events', async () => {
    vi.useFakeTimers();
    sent.length = 0;
    for (const key of Object.keys(handlers)) {
      delete handlers[key];
    }

    document.body.innerHTML = '<main id="app"></main>';
    const root = /** @type {HTMLElement} */ (document.getElementById('app'));
    bootstrap(root);
    await Promise.resolve();
    await Promise.resolve();

    const initial_list_calls = sent.filter(
      (call) => call.type === 'list-workspaces'
    ).length;
    const initial_unsub_calls = sent.filter(
      (call) => call.type === 'unsubscribe-list'
    ).length;
    expect(initial_list_calls).toBeGreaterThan(0);

    handlers['workspaces-updated']?.({ source: 'registry', ts: Date.now() });
    handlers['workspaces-updated']?.({ source: 'registry', ts: Date.now() });
    await vi.advanceTimersByTimeAsync(120);

    const mid_list_calls = sent.filter(
      (call) => call.type === 'list-workspaces'
    ).length;
    expect(mid_list_calls).toBe(initial_list_calls);

    await vi.advanceTimersByTimeAsync(80);
    await Promise.resolve();

    const final_list_calls = sent.filter(
      (call) => call.type === 'list-workspaces'
    ).length;
    const final_unsub_calls = sent.filter(
      (call) => call.type === 'unsubscribe-list'
    ).length;
    expect(final_list_calls).toBe(initial_list_calls + 1);
    expect(final_unsub_calls).toBe(initial_unsub_calls);

    vi.useRealTimers();
  });
});
