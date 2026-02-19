/**
 * Minimal app state store with subscription.
 */
import { debug } from './utils/logging.js';

/**
 * @typedef {'all'|'open'|'in_progress'|'closed'|'ready'} StatusFilter
 */

/**
 * @typedef {{ status: StatusFilter, search: string, type: string }} Filters
 */

/**
 * @typedef {'issues'|'epics'|'board'|'integrations'} ViewName
 */

/**
 * @typedef {'all'|'today'|'3'|'7'} ClosedFilter
 */

/**
 * @typedef {{ closed_filter: ClosedFilter, label_filters: string[], priority_filters: number[], created_from: string, created_to: string }} BoardState
 */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeBoardLabels(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  /** @type {Set<string>} */
  const labels_set = new Set();
  for (const item of value) {
    const text = String(item || '').trim();
    if (text) {
      labels_set.add(text);
    }
  }
  return Array.from(labels_set);
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function normalizeBoardPriorities(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  /** @type {Set<number>} */
  const priorities_set = new Set();
  for (const item of value) {
    const numeric = Number(item);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 4) {
      priorities_set.add(numeric);
    }
  }
  return Array.from(priorities_set).sort((a, b) => a - b);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBoardDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  return '';
}

/**
 * @typedef {Object} WorkspaceInfo
 * @property {string} path - Full path to workspace
 * @property {string} database - Path to the database file
 * @property {number} [pid] - Process ID of the daemon
 * @property {string} [version] - Version of beads
 */

/**
 * @typedef {Object} WorkspaceState
 * @property {WorkspaceInfo | null} current - Currently active workspace
 * @property {WorkspaceInfo[]} available - All available workspaces
 */

/**
 * @typedef {{ selected_id: string | null, view: ViewName, filters: Filters, board: BoardState, workspace: WorkspaceState }} AppState
 */

/**
 * Create a simple store for application state.
 *
 * @param {Partial<AppState>} [initial]
 * @returns {{ getState: () => AppState, setState: (patch: { selected_id?: string | null, filters?: Partial<Filters>, board?: Partial<BoardState>, workspace?: Partial<WorkspaceState> }) => void, subscribe: (fn: (s: AppState) => void) => () => void }}
 */
export function createStore(initial = {}) {
  const log = debug('state');
  /** @type {AppState} */
  let state = {
    selected_id: initial.selected_id ?? null,
    view: initial.view ?? 'issues',
    filters: {
      status: initial.filters?.status ?? 'all',
      search: initial.filters?.search ?? '',
      type:
        typeof initial.filters?.type === 'string' ? initial.filters?.type : ''
    },
    board: {
      closed_filter:
        initial.board?.closed_filter === 'all' ||
        initial.board?.closed_filter === '3' ||
        initial.board?.closed_filter === '7' ||
        initial.board?.closed_filter === 'today'
          ? initial.board?.closed_filter
          : 'all',
      label_filters: normalizeBoardLabels(initial.board?.label_filters),
      priority_filters: normalizeBoardPriorities(
        initial.board?.priority_filters
      ),
      created_from: normalizeBoardDate(initial.board?.created_from),
      created_to: normalizeBoardDate(initial.board?.created_to)
    },
    workspace: {
      current: initial.workspace?.current ?? null,
      available: initial.workspace?.available ?? []
    }
  };

  /** @type {Set<(s: AppState) => void>} */
  const subs = new Set();

  function emit() {
    for (const fn of Array.from(subs)) {
      try {
        fn(state);
      } catch {
        // ignore
      }
    }
  }

  return {
    getState() {
      return state;
    },
    /**
     * Update state. Nested filters can be partial.
     *
     * @param {{ selected_id?: string | null, filters?: Partial<Filters>, board?: Partial<BoardState>, workspace?: Partial<WorkspaceState> }} patch
     */
    setState(patch) {
      /** @type {AppState} */
      const next = {
        ...state,
        ...patch,
        filters: { ...state.filters, ...(patch.filters || {}) },
        board: {
          ...state.board,
          ...(patch.board || {}),
          label_filters: normalizeBoardLabels(
            patch.board?.label_filters ?? state.board.label_filters
          ),
          priority_filters: normalizeBoardPriorities(
            patch.board?.priority_filters ?? state.board.priority_filters
          ),
          created_from: normalizeBoardDate(
            patch.board?.created_from ?? state.board.created_from
          ),
          created_to: normalizeBoardDate(
            patch.board?.created_to ?? state.board.created_to
          )
        },
        workspace: {
          current:
            patch.workspace?.current !== undefined
              ? patch.workspace.current
              : state.workspace.current,
          available:
            patch.workspace?.available !== undefined
              ? patch.workspace.available
              : state.workspace.available
        }
      };
      // Avoid emitting if nothing changed (shallow compare)
      const workspace_changed =
        next.workspace.current?.path !== state.workspace.current?.path ||
        next.workspace.available.length !== state.workspace.available.length;
      if (
        next.selected_id === state.selected_id &&
        next.view === state.view &&
        next.filters.status === state.filters.status &&
        next.filters.search === state.filters.search &&
        next.filters.type === state.filters.type &&
        next.board.closed_filter === state.board.closed_filter &&
        JSON.stringify(next.board.label_filters) ===
          JSON.stringify(state.board.label_filters) &&
        JSON.stringify(next.board.priority_filters) ===
          JSON.stringify(state.board.priority_filters) &&
        next.board.created_from === state.board.created_from &&
        next.board.created_to === state.board.created_to &&
        !workspace_changed
      ) {
        return;
      }
      state = next;
      log('state change %o', {
        selected_id: state.selected_id,
        view: state.view,
        filters: state.filters,
        board: state.board,
        workspace: state.workspace.current?.path
      });
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}
