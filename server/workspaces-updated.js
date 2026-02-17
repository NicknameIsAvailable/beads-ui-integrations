/**
 * @import { MessageType } from '../app/protocol.js'
 */
import path from 'node:path';

/**
 * @typedef {'registry'|'register-workspace'} WorkspaceUpdateSource
 */

/**
 * @typedef {{
 *   path: string,
 *   database: string,
 *   pid?: number,
 *   version?: string
 * }} WorkspaceEntry
 */

/**
 * Create a stable snapshot for workspace list comparison.
 *
 * @param {WorkspaceEntry[]} workspaces
 * @returns {string}
 */
export function snapshotWorkspaces(workspaces) {
  /** @type {Array<{ path: string, database: string, pid: number, version: string }>} */
  const normalized = workspaces.map((workspace) => ({
    path: path.resolve(String(workspace.path || '')),
    database: path.resolve(String(workspace.database || '')),
    pid: typeof workspace.pid === 'number' ? workspace.pid : -1,
    version: typeof workspace.version === 'string' ? workspace.version : ''
  }));

  normalized.sort((a, b) => {
    if (a.path === b.path) {
      return a.database.localeCompare(b.database);
    }
    return a.path.localeCompare(b.path);
  });

  return JSON.stringify(normalized);
}

/**
 * Build a guarded broadcaster for `workspaces-updated`.
 * The returned function emits only when the effective workspace list changed.
 *
 * @param {{
 *   get_workspaces: () => WorkspaceEntry[],
 *   broadcast: (type: MessageType, payload?: unknown) => void,
 *   now?: () => number,
 *   log?: (...args: unknown[]) => void
 * }} options
 * @returns {(source: WorkspaceUpdateSource) => boolean}
 */
export function createWorkspacesUpdatedBroadcaster(options) {
  const now = options.now || Date.now;
  const log = options.log || (() => {});
  let last_snapshot = snapshotWorkspaces(options.get_workspaces());

  return (source) => {
    const workspaces = options.get_workspaces();
    const next_snapshot = snapshotWorkspaces(workspaces);
    if (next_snapshot === last_snapshot) {
      log(
        'workspace list unchanged; skip workspaces-updated source=%s',
        source
      );
      return false;
    }

    last_snapshot = next_snapshot;
    options.broadcast('workspaces-updated', {
      source,
      ts: now(),
      count: workspaces.length
    });
    return true;
  };
}
