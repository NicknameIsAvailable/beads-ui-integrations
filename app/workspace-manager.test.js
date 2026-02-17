import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createStore } from './state.js';
import { createWorkspaceManager } from './workspace-manager.js';

/**
 * @typedef {{
 *   send_calls: Array<{ type: string, payload: unknown }>,
 *   handlers: Record<string, (payload: any) => void>,
 *   client: {
 *     send: (type: string, payload?: unknown) => Promise<any>,
 *     on: (type: string, handler: (payload: any) => void) => (() => void)
 *   }
 * }} MockClient
 */

/**
 * @param {{
 *   on_send?: (type: string, payload: unknown) => any
 * }} [options]
 * @returns {MockClient}
 */
function createMockClient(options = {}) {
  /** @type {Array<{ type: string, payload: unknown }>} */
  const send_calls = [];
  /** @type {Record<string, (payload: any) => void>} */
  const handlers = {};

  return {
    send_calls,
    handlers,
    client: {
      async send(type, payload) {
        send_calls.push({ type, payload });
        return options.on_send ? options.on_send(type, payload) : null;
      },
      on(type, handler) {
        handlers[type] = handler;
        return () => {
          delete handlers[type];
        };
      }
    }
  };
}

describe('workspace manager', () => {
  beforeEach(() => {
    window.localStorage.removeItem('beads-ui.workspace');
  });

  test('loads workspace list into store', async () => {
    const mock_client = createMockClient({
      on_send(type) {
        if (type !== 'list-workspaces') {
          return null;
        }
        return {
          workspaces: [
            {
              path: '/projects/a',
              database: '/projects/a/.beads/bd.db',
              pid: 22,
              version: '1.2.0'
            },
            {
              path: '/projects/b',
              database: '/projects/b/.beads/bd.db',
              pid: 23,
              version: '1.2.0'
            }
          ],
          current: {
            root_dir: '/projects/a',
            db_path: '/projects/a/.beads/bd.db'
          }
        };
      }
    });
    const store = createStore();
    const clear_and_resubscribe = vi.fn(async () => {});

    const workspace_manager = createWorkspaceManager({
      client: mock_client.client,
      store,
      log: () => {},
      clearAndResubscribe: clear_and_resubscribe
    });

    await workspace_manager.loadWorkspaces();

    expect(store.getState().workspace.current?.path).toBe('/projects/a');
    expect(store.getState().workspace.available).toHaveLength(2);
    expect(window.localStorage.getItem('beads-ui.workspace')).toBe(
      '/projects/a'
    );

    workspace_manager.destroy();
  });

  test('coalesces burst of workspaces-updated events into one reload', async () => {
    vi.useFakeTimers();

    let list_requests = 0;
    const mock_client = createMockClient({
      on_send(type) {
        if (type !== 'list-workspaces') {
          return null;
        }
        list_requests += 1;
        return {
          workspaces: [
            {
              path: '/projects/a',
              database: '/projects/a/.beads/bd.db'
            }
          ],
          current: {
            root_dir: '/projects/a',
            db_path: '/projects/a/.beads/bd.db'
          }
        };
      }
    });
    const store = createStore();
    const clear_and_resubscribe = vi.fn(async () => {});

    const workspace_manager = createWorkspaceManager({
      client: mock_client.client,
      store,
      log: () => {},
      clearAndResubscribe: clear_and_resubscribe
    });

    await workspace_manager.loadWorkspaces();
    expect(list_requests).toBe(1);

    mock_client.handlers['workspaces-updated']?.({ source: 'registry', ts: 1 });
    mock_client.handlers['workspaces-updated']?.({ source: 'registry', ts: 2 });

    await vi.advanceTimersByTimeAsync(120);
    expect(list_requests).toBe(1);
    expect(clear_and_resubscribe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(80);
    await Promise.resolve();

    expect(list_requests).toBe(2);

    workspace_manager.destroy();
    vi.useRealTimers();
  });

  test('handles workspace-changed by resubscribing and refreshing list', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('beads-ui.workspace', '/projects/a');

    let list_requests = 0;
    const mock_client = createMockClient({
      on_send(type) {
        if (type !== 'list-workspaces') {
          return null;
        }
        list_requests += 1;
        return {
          workspaces: [
            {
              path: '/projects/b',
              database: '/projects/b/.beads/bd.db'
            }
          ],
          current: {
            root_dir: '/projects/b',
            db_path: '/projects/b/.beads/bd.db'
          }
        };
      }
    });
    const store = createStore();
    const clear_and_resubscribe = vi.fn(async () => {});

    const workspace_manager = createWorkspaceManager({
      client: mock_client.client,
      store,
      log: () => {},
      clearAndResubscribe: clear_and_resubscribe
    });

    mock_client.handlers['workspace-changed']?.({
      root_dir: '/projects/b',
      db_path: '/projects/b/.beads/bd.db'
    });

    expect(store.getState().workspace.current?.path).toBe('/projects/b');
    expect(window.localStorage.getItem('beads-ui.workspace')).toBe(
      '/projects/b'
    );
    expect(clear_and_resubscribe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(list_requests).toBe(1);

    workspace_manager.destroy();
    vi.useRealTimers();
  });

  test('skips resubscribe when set-workspace reports unchanged workspace', async () => {
    const mock_client = createMockClient({
      on_send(type) {
        if (type !== 'set-workspace') {
          return null;
        }
        return {
          changed: false,
          workspace: {
            root_dir: '/projects/a',
            db_path: '/projects/a/.beads/bd.db'
          }
        };
      }
    });
    const store = createStore();
    const clear_and_resubscribe = vi.fn(async () => {});

    const workspace_manager = createWorkspaceManager({
      client: mock_client.client,
      store,
      log: () => {},
      clearAndResubscribe: clear_and_resubscribe
    });

    await workspace_manager.handleWorkspaceChange('/projects/a');

    expect(clear_and_resubscribe).not.toHaveBeenCalled();

    workspace_manager.destroy();
  });
});
