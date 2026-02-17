import { describe, expect, test, vi } from 'vitest';
import { createStore } from '../state.js';
import { createWorkspacePicker } from './workspace-picker.js';

/**
 * @param {string} path
 * @returns {{ path: string, database: string }}
 */
function workspace(path) {
  return { path, database: `${path}/.beads/bd.db` };
}

describe('workspace picker', () => {
  test('renders disambiguated labels for duplicate project names', async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const store = createStore({
      workspace: {
        current: workspace('/Users/me/projects/org-a/app'),
        available: [
          workspace('/Users/me/projects/org-a/app'),
          workspace('/Users/me/projects/org-b/app'),
          workspace('/Users/me/projects/org-c/docs')
        ]
      }
    });

    createWorkspacePicker(mount, store, async () => {});
    await Promise.resolve();

    const option_labels = Array.from(mount.querySelectorAll('option')).map(
      (option) => option.textContent?.trim() || ''
    );

    expect(option_labels).toContain('app (org-a)');
    expect(option_labels).toContain('app (org-b)');
    expect(option_labels).toContain('docs');
  });

  test('calls workspace change handler with selected path', async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('mount'));
    const on_workspace_change = vi.fn(async () => {});
    const store = createStore({
      workspace: {
        current: workspace('/Users/me/projects/org-a/app'),
        available: [
          workspace('/Users/me/projects/org-a/app'),
          workspace('/Users/me/projects/org-b/app')
        ]
      }
    });

    createWorkspacePicker(mount, store, on_workspace_change);
    await Promise.resolve();

    const select = /** @type {HTMLSelectElement} */ (
      mount.querySelector('.workspace-picker__select')
    );
    select.value = '/Users/me/projects/org-b/app';
    select.dispatchEvent(new Event('change'));

    expect(on_workspace_change).toHaveBeenCalledWith(
      '/Users/me/projects/org-b/app'
    );
  });
});
