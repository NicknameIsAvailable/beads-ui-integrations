/**
 * @import { MessageType } from './protocol.js'
 */

/**
 * @typedef {{
 *   send: (type: MessageType, payload?: unknown) => Promise<any>,
 *   on: (type: MessageType, handler: (payload: any) => void) => (() => void)
 * }} WorkspaceClient
 */

/**
 * @typedef {{
 *   getState: () => any,
 *   setState: (next_state: any) => void
 * }} WorkspaceStore
 */

/**
 * @typedef {{
 *   client: WorkspaceClient,
 *   store: WorkspaceStore,
 *   log: (...args: unknown[]) => void,
 *   clearAndResubscribe: () => Promise<void>,
 *   onSwitchSuccess?: (workspace_name: string) => void,
 *   onSwitchError?: () => void,
 *   reloadDebounceMs?: number
 * }} WorkspaceManagerOptions
 */

/**
 * Extract a project-style name from a workspace path.
 *
 * @param {string} workspace_path
 * @returns {string}
 */
export function getProjectName(workspace_path) {
  if (!workspace_path) {
    return 'Unknown';
  }
  const parts = workspace_path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'Unknown';
}

/**
 * Manage workspace synchronization between WS events, state, and UI actions.
 *
 * @param {WorkspaceManagerOptions} options
 */
export function createWorkspaceManager(options) {
  const reload_debounce_ms = options.reloadDebounceMs ?? 180;

  /** @type {ReturnType<typeof setTimeout> | null} */
  let workspaces_reload_timer = null;

  /** @type {(() => void) | null} */
  let off_workspace_changed = null;
  /** @type {(() => void) | null} */
  let off_workspaces_updated = null;

  /**
   * Load available workspaces from server and update state.
   */
  async function loadWorkspaces() {
    try {
      const result = await options.client.send('list-workspaces', {});
      options.log('workspaces loaded: %o', result);
      if (!result || !Array.isArray(result.workspaces)) {
        return;
      }

      const available = result.workspaces.map((/** @type {any} */ ws) => ({
        path: ws.path,
        database: ws.database,
        pid: ws.pid,
        version: ws.version
      }));
      const current = result.current
        ? {
            path: result.current.root_dir,
            database: result.current.db_path
          }
        : null;
      options.store.setState({ workspace: { current, available } });
      if (current && current.path) {
        // Keep HTTP integration requests aligned with active workspace.
        window.localStorage.setItem('beads-ui.workspace', current.path);
      }

      // Restore persisted preference only when it differs and still exists.
      const saved_workspace = window.localStorage.getItem('beads-ui.workspace');
      if (!saved_workspace || !current || saved_workspace === current.path) {
        return;
      }
      const saved_exists = available.some(
        (/** @type {{ path: string }} */ workspace) =>
          workspace.path === saved_workspace
      );
      if (!saved_exists) {
        return;
      }
      options.log('restoring saved workspace preference: %s', saved_workspace);
      await handleWorkspaceChange(saved_workspace);
    } catch (err) {
      options.log('failed to load workspaces: %o', err);
    }
  }

  /**
   * Debounced workspace list refresh to coalesce server event bursts.
   *
   * @param {number} [delay_ms]
   */
  function scheduleWorkspaceReload(delay_ms = reload_debounce_ms) {
    if (workspaces_reload_timer) {
      clearTimeout(workspaces_reload_timer);
    }
    workspaces_reload_timer = setTimeout(() => {
      workspaces_reload_timer = null;
      void loadWorkspaces();
    }, delay_ms);
    workspaces_reload_timer.unref?.();
  }

  /**
   * Handle workspace switch request from UI.
   *
   * @param {string} workspace_path
   */
  async function handleWorkspaceChange(workspace_path) {
    options.log('requesting workspace switch to %s', workspace_path);
    try {
      const result = await options.client.send('set-workspace', {
        path: workspace_path
      });
      options.log('workspace switch result: %o', result);
      if (!result || !result.workspace) {
        return;
      }

      options.store.setState({
        workspace: {
          current: {
            path: result.workspace.root_dir,
            database: result.workspace.db_path
          }
        }
      });
      window.localStorage.setItem('beads-ui.workspace', workspace_path);

      if (!result.changed) {
        return;
      }
      await options.clearAndResubscribe();
      options.onSwitchSuccess?.(getProjectName(workspace_path));
    } catch (err) {
      options.log('workspace switch failed: %o', err);
      options.onSwitchError?.();
      throw err;
    }
  }

  off_workspace_changed = options.client.on('workspace-changed', (payload) => {
    options.log('workspace-changed event: %o', payload);
    if (!payload || !payload.root_dir) {
      return;
    }
    options.store.setState({
      workspace: {
        current: {
          path: payload.root_dir,
          database: payload.db_path
        }
      }
    });
    window.localStorage.setItem('beads-ui.workspace', payload.root_dir);
    scheduleWorkspaceReload(0);
    void options.clearAndResubscribe();
  });

  off_workspaces_updated = options.client.on(
    'workspaces-updated',
    (payload) => {
      options.log('workspaces-updated event: %o', payload);
      scheduleWorkspaceReload();
    }
  );

  return {
    loadWorkspaces,
    scheduleWorkspaceReload,
    handleWorkspaceChange,
    destroy() {
      if (workspaces_reload_timer) {
        clearTimeout(workspaces_reload_timer);
        workspaces_reload_timer = null;
      }
      if (off_workspace_changed) {
        off_workspace_changed();
        off_workspace_changed = null;
      }
      if (off_workspaces_updated) {
        off_workspaces_updated();
        off_workspaces_updated = null;
      }
    }
  };
}
