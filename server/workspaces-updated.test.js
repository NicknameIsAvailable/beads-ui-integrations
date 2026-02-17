import { describe, expect, test, vi } from 'vitest';
import {
  createWorkspacesUpdatedBroadcaster,
  snapshotWorkspaces
} from './workspaces-updated.js';

describe('workspace update broadcaster', () => {
  test('returns stable snapshots independent of ordering', () => {
    const left = snapshotWorkspaces([
      {
        path: '/repo-b',
        database: '/repo-b/.beads/bd.db',
        pid: 2,
        version: 'x'
      },
      {
        path: '/repo-a',
        database: '/repo-a/.beads/bd.db',
        pid: 1,
        version: 'x'
      }
    ]);

    const right = snapshotWorkspaces([
      {
        path: '/repo-a',
        database: '/repo-a/.beads/bd.db',
        pid: 1,
        version: 'x'
      },
      {
        path: '/repo-b',
        database: '/repo-b/.beads/bd.db',
        pid: 2,
        version: 'x'
      }
    ]);

    expect(left).toBe(right);
  });

  test('broadcasts workspaces-updated when registry change modifies list', () => {
    let workspaces = [
      {
        path: '/repo-a',
        database: '/repo-a/.beads/bd.db',
        pid: 1,
        version: 'x'
      }
    ];
    const broadcast = vi.fn();
    const notify = createWorkspacesUpdatedBroadcaster({
      get_workspaces: () => workspaces,
      broadcast,
      now: () => 1_234
    });

    const unchanged = notify('registry');

    expect(unchanged).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();

    workspaces = [
      {
        path: '/repo-a',
        database: '/repo-a/.beads/bd.db',
        pid: 1,
        version: 'x'
      },
      {
        path: '/repo-b',
        database: '/repo-b/.beads/bd.db',
        pid: 2,
        version: 'x'
      }
    ];

    const changed = notify('registry');

    expect(changed).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith('workspaces-updated', {
      source: 'registry',
      ts: 1_234,
      count: 2
    });
  });

  test('broadcasts register-workspace source when API registration changes list', () => {
    let workspaces = [
      {
        path: '/repo-a',
        database: '/repo-a/.beads/bd.db',
        pid: 1,
        version: 'x'
      }
    ];
    const broadcast = vi.fn();
    const notify = createWorkspacesUpdatedBroadcaster({
      get_workspaces: () => workspaces,
      broadcast,
      now: () => 5_678
    });

    workspaces = [
      {
        path: '/repo-a',
        database: '/repo-a/.beads/bd.db',
        pid: 1,
        version: 'x'
      },
      {
        path: '/repo-c',
        database: '/repo-c/.beads/bd.db',
        pid: 3,
        version: 'dynamic'
      }
    ];

    const changed = notify('register-workspace');

    expect(changed).toBe(true);
    expect(broadcast).toHaveBeenCalledWith('workspaces-updated', {
      source: 'register-workspace',
      ts: 5_678,
      count: 2
    });
  });
});
