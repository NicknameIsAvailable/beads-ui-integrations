import { html, render } from 'lit-html';
import { debug } from '../utils/logging.js';

/**
 * @typedef {import('../state.js').WorkspaceInfo} WorkspaceInfo
 */

/**
 * Extract the project name from a workspace path. Returns just the directory
 * name (e.g., 'myproject' from '/home/user/code/myproject').
 *
 * @param {string} workspace_path
 * @returns {string}
 */
function getProjectName(workspace_path) {
  if (!workspace_path) return 'Unknown';
  const parts = workspace_path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'Unknown';
}

/**
 * Create a short path label that remains readable in narrow headers.
 *
 * @param {string} workspace_path
 * @returns {string}
 */
function compactPath(workspace_path) {
  if (!workspace_path) {
    return '';
  }
  const parts = workspace_path.split('/').filter(Boolean);
  if (parts.length <= 3) {
    return workspace_path;
  }
  return `.../${parts.slice(-3).join('/')}`;
}

/**
 * Build deterministic and disambiguated option labels.
 * Duplicate project names are expanded with parent/path hints.
 *
 * @param {WorkspaceInfo[]} available
 * @returns {Array<{ workspace: WorkspaceInfo, label: string }>}
 */
function buildWorkspaceOptions(available) {
  /** @type {Map<string, number>} */
  const name_counts = new Map();
  for (const workspace of available) {
    const name = getProjectName(workspace.path);
    name_counts.set(name, (name_counts.get(name) || 0) + 1);
  }

  /** @type {Array<{ workspace: WorkspaceInfo, label: string }>} */
  const with_labels = [];
  for (const workspace of available) {
    const name = getProjectName(workspace.path);
    const count = name_counts.get(name) || 0;
    if (count <= 1) {
      with_labels.push({ workspace, label: name });
      continue;
    }
    const parts = workspace.path.split('/').filter(Boolean);
    const parent_name = parts.length > 1 ? parts[parts.length - 2] : '';
    const suffix = parent_name || compactPath(workspace.path);
    with_labels.push({ workspace, label: `${name} (${suffix})` });
  }

  /** @type {Map<string, number>} */
  const label_counts = new Map();
  for (const item of with_labels) {
    label_counts.set(item.label, (label_counts.get(item.label) || 0) + 1);
  }

  return with_labels
    .map((item) => {
      const duplicate = (label_counts.get(item.label) || 0) > 1;
      if (!duplicate) {
        return item;
      }
      return {
        workspace: item.workspace,
        label: `${item.label} - ${compactPath(item.workspace.path)}`
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Create the workspace picker dropdown component.
 *
 * @param {HTMLElement} mount_element
 * @param {{ getState: () => any, subscribe: (fn: (s: any) => void) => () => void }} store
 * @param {(workspace_path: string) => Promise<void>} onWorkspaceChange
 */
export function createWorkspacePicker(mount_element, store, onWorkspaceChange) {
  const log = debug('views:workspace-picker');
  /** @type {(() => void) | null} */
  let unsubscribe = null;
  /** @type {boolean} */
  let is_switching = false;

  /**
   * Handle workspace selection change.
   *
   * @param {Event} ev
   */
  async function onChange(ev) {
    const select = /** @type {HTMLSelectElement} */ (ev.target);
    const new_path = select.value;
    const s = store.getState();
    const current_path = s.workspace?.current?.path || '';

    if (new_path && new_path !== current_path) {
      log('switching workspace to %s', new_path);
      is_switching = true;
      doRender();
      try {
        await onWorkspaceChange(new_path);
      } catch (err) {
        log('workspace switch failed: %o', err);
      } finally {
        is_switching = false;
        doRender();
      }
    }
  }

  function template() {
    const s = store.getState();
    const current = s.workspace?.current;
    const available = s.workspace?.available || [];

    // Don't render if no workspaces available
    if (available.length === 0) {
      return html``;
    }

    // Show dropdown (even if only one workspace)
    const current_path = current?.path || '';
    const workspace_options = buildWorkspaceOptions(available);
    const count_label =
      available.length === 1 ? '1 workspace' : `${available.length} workspaces`;
    const current_path_label = compactPath(current_path);

    return html`
      <div class="workspace-picker">
        <div class="workspace-picker__controls">
          <select
            class="workspace-picker__select"
            @change=${onChange}
            ?disabled=${is_switching}
            aria-label="Select project workspace"
          >
            ${workspace_options.map(
              (item) => html`
                <option
                  value="${item.workspace.path}"
                  ?selected=${item.workspace.path === current_path}
                  title="${item.workspace.path}"
                >
                  ${item.label}
                </option>
              `
            )}
          </select>
          ${is_switching
            ? html`<span
                class="workspace-picker__loading"
                aria-hidden="true"
              ></span>`
            : ''}
        </div>
        <div class="workspace-picker__meta" title="${current_path}">
          <span class="workspace-picker__count">${count_label}</span>
          <span class="workspace-picker__path">${current_path_label}</span>
        </div>
        <div class="visually-hidden" aria-live="polite">
          Current workspace:
          ${workspace_options
            .filter((item) => item.workspace.path === current_path)
            .map((item) => item.label)
            .join('')}
        </div>
      </div>
    `;
  }

  function doRender() {
    render(template(), mount_element);
  }

  doRender();
  unsubscribe = store.subscribe(() => doRender());

  return {
    destroy() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      render(html``, mount_element);
    }
  };
}
