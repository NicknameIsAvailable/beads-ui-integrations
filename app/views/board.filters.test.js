import { describe, expect, test } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { createBoardView } from './board.js';

function createTestIssueStores() {
  /** @type {Map<string, any>} */
  const stores = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /**
   * @param {string} id
   * @returns {any}
   */
  function getStore(id) {
    let s = stores.get(id);
    if (!s) {
      s = createSubscriptionIssueStore(id);
      stores.set(id, s);
      s.subscribe(() => {
        for (const fn of Array.from(listeners)) {
          try {
            fn();
          } catch {
            /* ignore */
          }
        }
      });
    }
    return s;
  }
  return {
    getStore,
    /** @param {string} id */
    snapshotFor(id) {
      return getStore(id).snapshot().slice();
    },
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

/**
 * @param {HTMLElement} mount
 * @param {string} trigger_selector
 * @param {string} option_text
 */
function toggleDropdownOption(mount, trigger_selector, option_text) {
  const trigger = /** @type {HTMLButtonElement} */ (
    mount.querySelector(trigger_selector)
  );
  trigger.click();

  const dropdown = /** @type {HTMLElement} */ (
    trigger.closest('.filter-dropdown')
  );
  const option = Array.from(
    dropdown.querySelectorAll('.filter-dropdown__option')
  ).find((el) => el.textContent?.includes(option_text));
  const checkbox = /** @type {HTMLInputElement} */ (
    option?.querySelector('input[type="checkbox"]')
  );
  checkbox.click();
}

/**
 * @param {HTMLElement} mount
 * @param {string} column_id
 * @returns {string[]}
 */
function collectColumnIds(mount, column_id) {
  return Array.from(mount.querySelectorAll(`#${column_id} .board-card`)).map(
    (el) => String(el.getAttribute('data-issue-id') || '')
  );
}

describe('views/board filters', () => {
  test('filters all columns by labels priorities and created date range', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issue_stores = createTestIssueStores();
    const now = Date.now();

    issue_stores.getStore('tab:board:blocked').applyPush({
      type: 'snapshot',
      id: 'tab:board:blocked',
      revision: 1,
      issues: [
        {
          id: 'B-1',
          title: 'blocked frontend',
          labels: ['frontend'],
          priority: 1,
          created_at: new Date('2026-01-05T10:00:00.000Z').getTime()
        },
        {
          id: 'B-2',
          title: 'blocked backend',
          labels: ['backend'],
          priority: 1,
          created_at: new Date('2026-01-12T10:00:00.000Z').getTime()
        }
      ]
    });
    issue_stores.getStore('tab:board:ready').applyPush({
      type: 'snapshot',
      id: 'tab:board:ready',
      revision: 1,
      issues: [
        {
          id: 'R-1',
          title: 'ready frontend',
          labels: ['frontend'],
          priority: 1,
          created_at: new Date('2026-01-12T10:00:00.000Z').getTime()
        },
        {
          id: 'R-2',
          title: 'ready p2',
          labels: ['frontend', 'backend'],
          priority: 2,
          created_at: new Date('2026-01-15T10:00:00.000Z').getTime()
        }
      ]
    });
    issue_stores.getStore('tab:board:in-progress').applyPush({
      type: 'snapshot',
      id: 'tab:board:in-progress',
      revision: 1,
      issues: [
        {
          id: 'P-1',
          title: 'progress january',
          labels: ['frontend'],
          priority: 1,
          created_at: new Date('2026-01-14T10:00:00.000Z').getTime()
        },
        {
          id: 'P-2',
          title: 'progress february',
          labels: ['frontend'],
          priority: 1,
          created_at: new Date('2026-02-02T10:00:00.000Z').getTime()
        }
      ]
    });
    issue_stores.getStore('tab:board:closed').applyPush({
      type: 'snapshot',
      id: 'tab:board:closed',
      revision: 1,
      issues: [
        {
          id: 'C-1',
          title: 'closed january',
          labels: ['frontend'],
          priority: 1,
          created_at: new Date('2026-01-18T10:00:00.000Z').getTime(),
          closed_at: now
        },
        {
          id: 'C-2',
          title: 'closed december',
          labels: ['frontend'],
          priority: 1,
          created_at: new Date('2025-12-30T10:00:00.000Z').getTime(),
          closed_at: now - 1000
        }
      ]
    });

    /** @type {{ state: any, getState: () => any, setState: (patch: any) => void, subscribe: () => () => void }} */
    const store = {
      state: {
        selected_id: null,
        view: 'board',
        filters: { status: 'all', search: '', type: '' },
        board: {
          closed_filter: 'all',
          label_filters: [],
          priority_filters: [],
          created_from: '',
          created_to: ''
        }
      },
      getState() {
        return this.state;
      },
      setState(patch) {
        this.state = {
          ...this.state,
          ...(patch || {}),
          filters: { ...this.state.filters, ...(patch.filters || {}) },
          board: { ...this.state.board, ...(patch.board || {}) }
        };
      },
      subscribe() {
        return () => {};
      }
    };

    const view = createBoardView(
      mount,
      null,
      () => {},
      store,
      undefined,
      issue_stores
    );
    await view.load();

    expect(collectColumnIds(mount, 'blocked-col')).toEqual(['B-1', 'B-2']);
    expect(collectColumnIds(mount, 'ready-col')).toEqual(['R-1', 'R-2']);
    expect(collectColumnIds(mount, 'in-progress-col')).toEqual(['P-1', 'P-2']);
    expect(collectColumnIds(mount, 'closed-col')).toEqual(['C-1', 'C-2']);

    toggleDropdownOption(mount, '#board-label-filter-trigger', 'frontend');
    toggleDropdownOption(mount, '#board-priority-filter-trigger', 'P1');

    const created_from = /** @type {HTMLInputElement} */ (
      mount.querySelector('#board-created-from')
    );
    created_from.value = '2026-01-10';
    created_from.dispatchEvent(new Event('change', { bubbles: true }));

    const created_to = /** @type {HTMLInputElement} */ (
      mount.querySelector('#board-created-to')
    );
    created_to.value = '2026-01-31';
    created_to.dispatchEvent(new Event('change', { bubbles: true }));

    expect(collectColumnIds(mount, 'blocked-col')).toEqual([]);
    expect(collectColumnIds(mount, 'ready-col')).toEqual(['R-1']);
    expect(collectColumnIds(mount, 'in-progress-col')).toEqual(['P-1']);
    expect(collectColumnIds(mount, 'closed-col')).toEqual(['C-1']);

    expect(store.getState().board.label_filters).toEqual(['frontend']);
    expect(store.getState().board.priority_filters).toEqual([1]);
    expect(store.getState().board.created_from).toBe('2026-01-10');
    expect(store.getState().board.created_to).toBe('2026-01-31');
  });
});
