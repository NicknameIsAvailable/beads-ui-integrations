import { html, render } from 'lit-html';
import { createListSelectors } from '../data/list-selectors.js';
import { cmpClosedDesc, cmpPriorityThenCreated } from '../data/sort.js';
import { createIssueIdRenderer } from '../utils/issue-id-renderer.js';
import { debug } from '../utils/logging.js';
import { createPriorityBadge } from '../utils/priority-badge.js';
import { showToast } from '../utils/toast.js';
import { createTypeBadge } from '../utils/type-badge.js';
import { createImportDialog } from './import-dialog.js';

/**
 * @typedef {{
 *   id: string,
 *   title?: string,
 *   status?: 'open'|'in_progress'|'closed',
 *   priority?: number,
 *   issue_type?: string,
 *   created_at?: number,
 *   updated_at?: number,
 *   closed_at?: number
 * }} IssueLite
 */

/**
 * Map column IDs to their corresponding status values.
 *
 * @type {Record<string, 'open'|'in_progress'|'closed'>}
 */
const COLUMN_STATUS_MAP = {
  'blocked-col': 'open',
  'ready-col': 'open',
  'in-progress-col': 'in_progress',
  'closed-col': 'closed'
};

/**
 * Create the Board view with Blocked, Ready, In progress, Closed.
 * Push-only: derives items from per-subscription stores.
 *
 * Sorting rules:
 * - Ready/Blocked/In progress: priority asc, then created_at asc.
 * - Closed: closed_at desc.
 *
 * @param {HTMLElement} mount_element
 * @param {unknown} _data - Unused (legacy param retained for call-compat)
 * @param {(id: string) => void} gotoIssue - Navigate to issue detail.
 * @param {{ getState: () => any, setState: (patch: any) => void, subscribe?: (fn: (s:any)=>void)=>()=>void }} [store]
 * @param {{ selectors: { getIds: (client_id: string) => string[], count?: (client_id: string) => number } }} [subscriptions]
 * @param {{ snapshotFor?: (client_id: string) => any[], subscribe?: (fn: () => void) => () => void }} [issueStores]
 * @param {(type: string, payload: unknown) => Promise<unknown>} [transport] - Transport function for sending updates
 * @returns {{ load: () => Promise<void>, clear: () => void }}
 */
export function createBoardView(
  mount_element,
  _data,
  gotoIssue,
  store,
  subscriptions = undefined,
  issueStores = undefined,
  transport = undefined
) {
  const log = debug('views:board');
  const import_dialog = createImportDialog();
  /** @type {IssueLite[]} */
  let list_ready = [];
  /** @type {IssueLite[]} */
  let list_blocked = [];
  /** @type {IssueLite[]} */
  let list_in_progress = [];
  /** @type {IssueLite[]} */
  let list_closed = [];
  /** @type {IssueLite[]} */
  let list_closed_raw = [];
  /** @type {Set<string>} */
  let selected_ids = new Set();
  // Centralized selection helpers
  const selectors = issueStores ? createListSelectors(issueStores) : null;

  /**
   * Closed column filter mode.
   * 'today' → items with closed_at since local day start
   * '3' → last 3 days; '7' → last 7 days
   *
   * @type {'today'|'3'|'7'}
   */
  let closed_filter_mode = 'today';
  if (store) {
    try {
      const s = store.getState();
      const cf =
        s && s.board ? String(s.board.closed_filter || 'today') : 'today';
      if (cf === 'today' || cf === '3' || cf === '7') {
        closed_filter_mode = /** @type {any} */ (cf);
      }
    } catch {
      // ignore store init errors
    }
  }

  function template() {
    return html`
      <div class="panel__body board-root">
        <div class="board-toolbar">
          <div class="board-toolbar__title">Board</div>
          <div class="board-toolbar__actions">
            ${selected_ids.size > 0
              ? html`
                  <div class="board-toolbar__selection">
                    <span>Выбрано: ${selected_ids.size}</span>
                    <button type="button" class="btn" @click=${clearSelection}>
                      Снять выделение
                    </button>
                    <button
                      type="button"
                      class="btn danger"
                      @click=${deleteSelected}
                    >
                      Удалить
                    </button>
                  </div>
                `
              : null}
            <button
              type="button"
              class="btn primary"
              @click=${openImportDialog}
            >
              Import tasks
            </button>
          </div>
        </div>
        <div class="board-columns">
          ${columnTemplate('Blocked', 'blocked-col', list_blocked)}
          ${columnTemplate('Ready', 'ready-col', list_ready)}
          ${columnTemplate('In Progress', 'in-progress-col', list_in_progress)}
          ${columnTemplate('Closed', 'closed-col', list_closed)}
        </div>
      </div>
    `;
  }

  /**
   * @param {string} title
   * @param {string} id
   * @param {IssueLite[]} items
   */
  function columnTemplate(title, id, items) {
    const item_count = Array.isArray(items) ? items.length : 0;
    const count_label = item_count === 1 ? '1 issue' : `${item_count} issues`;
    return html`
      <section class="board-column" id=${id}>
        <header
          class="board-column__header"
          id=${id + '-header'}
          role="heading"
          aria-level="2"
        >
          <div class="board-column__title">
            <span class="board-column__title-text">${title}</span>
            <span class="badge board-column__count" aria-label=${count_label}>
              ${item_count}
            </span>
          </div>
          ${item_count > 0
            ? html`
                <button
                  type="button"
                  class="board-column__select-all"
                  @click=${() => toggleSelectAll(id, items)}
                >
                  ${isAllSelected(items) ? 'Снять все' : 'Выбрать все'}
                </button>
              `
            : null}
          ${id === 'closed-col'
            ? html`<label class="board-closed-filter">
                <span class="visually-hidden">Filter closed issues</span>
                <select
                  id="closed-filter"
                  aria-label="Filter closed issues"
                  @change=${onClosedFilterChange}
                >
                  <option
                    value="today"
                    ?selected=${closed_filter_mode === 'today'}
                  >
                    Today
                  </option>
                  <option value="3" ?selected=${closed_filter_mode === '3'}>
                    Last 3 days
                  </option>
                  <option value="7" ?selected=${closed_filter_mode === '7'}>
                    Last 7 days
                  </option>
                </select>
              </label>`
            : ''}
        </header>
        <div
          class="board-column__body"
          role="list"
          aria-labelledby=${id + '-header'}
        >
          ${items.map((it) => cardTemplate(it, id))}
        </div>
      </section>
    `;
  }

  /**
   * @param {IssueLite} it
   * @param {string} column_id
   */
  function cardTemplate(it, column_id) {
    const is_selected = selected_ids.has(it.id);
    return html`
      <article
        class=${`board-card ${is_selected ? 'board-card--selected' : ''}`}
        data-issue-id=${it.id}
        data-column-id=${column_id}
        role="listitem"
        tabindex="-1"
        draggable="true"
        @click=${(/** @type {MouseEvent} */ ev) =>
          onCardClick(ev, it.id, column_id)}
        @dragstart=${(/** @type {DragEvent} */ ev) => onDragStart(ev, it.id)}
        @dragend=${onDragEnd}
      >
        <label class="board-card__select">
          <input
            type="checkbox"
            ?checked=${is_selected}
            @click=${(/** @type {MouseEvent} */ ev) => ev.stopPropagation()}
            @change=${(/** @type {Event} */ ev) => {
              ev.stopPropagation();
              toggleSelect(it.id, column_id);
            }}
          />
          <span class="visually-hidden">Select card</span>
        </label>
        <div class="board-card__title text-truncate">
          ${it.title || '(no title)'}
        </div>
        <div class="board-card__meta">
          ${createTypeBadge(it.issue_type)} ${createPriorityBadge(it.priority)}
          ${createIssueIdRenderer(it.id, { class_name: 'mono' })}
        </div>
      </article>
    `;
  }

  /** @type {string|null} */
  let dragging_id = null;
  /** @type {string|null} */
  let last_selected_id = null;
  /** @type {string|null} */
  let last_selected_column = null;

  /**
   * Handle card click, ignoring clicks during drag operations.
   *
   * @param {MouseEvent} ev
   * @param {string} id
   * @param {string} column_id
   */
  function onCardClick(ev, id, column_id) {
    const target = /** @type {HTMLElement} */ (ev.target);
    if (target.closest('.board-card__select')) {
      return;
    }
    if (ev.shiftKey) {
      selectRange(column_id, id);
      return;
    }
    if (ev.metaKey || ev.ctrlKey) {
      toggleSelect(id, column_id);
      return;
    }
    // Only navigate if this wasn't a drag operation
    if (!dragging_id) {
      gotoIssue(id);
    }
  }

  /**
   * @param {string} id
   * @param {string} column_id
   * @returns {void}
   */
  function toggleSelect(id, column_id) {
    /** @type {Set<string>} */
    const next = new Set(selected_ids);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selected_ids = next;
    last_selected_id = id;
    last_selected_column = column_id;
    doRender();
  }

  /**
   * @param {IssueLite[]} items
   * @returns {boolean}
   */
  function isAllSelected(items) {
    if (!items.length) {
      return false;
    }
    return items.every((item) => selected_ids.has(item.id));
  }

  /**
   * @param {string} column_id
   * @param {IssueLite[]} items
   * @returns {void}
   */
  function toggleSelectAll(column_id, items) {
    /** @type {Set<string>} */
    const next = new Set(selected_ids);
    if (isAllSelected(items)) {
      for (const item of items) {
        next.delete(item.id);
      }
    } else {
      for (const item of items) {
        next.add(item.id);
      }
    }
    selected_ids = next;
    if (items.length > 0) {
      last_selected_id = items[items.length - 1].id;
      last_selected_column = column_id;
    }
    doRender();
  }

  /**
   * @returns {void}
   */
  function clearSelection() {
    if (selected_ids.size === 0) {
      return;
    }
    selected_ids = new Set();
    last_selected_id = null;
    last_selected_column = null;
    doRender();
  }

  /**
   * @returns {void}
   */
  function pruneSelection() {
    if (selected_ids.size === 0) {
      return;
    }
    /** @type {Set<string>} */
    const present_ids = new Set(
      list_ready
        .concat(list_blocked, list_in_progress, list_closed)
        .map((item) => item.id)
    );
    /** @type {Set<string>} */
    const next = new Set();
    for (const id of selected_ids) {
      if (present_ids.has(id)) {
        next.add(id);
      }
    }
    selected_ids = next;
    if (!selected_ids.has(String(last_selected_id || ''))) {
      last_selected_id = null;
      last_selected_column = null;
    }
  }

  /**
   * @param {string} column_id
   * @returns {void}
   */
  function selectAllInColumn(column_id) {
    const items = getColumnItems(column_id);
    if (items.length === 0) {
      return;
    }
    /** @type {Set<string>} */
    const next = new Set(selected_ids);
    for (const item of items) {
      next.add(item.id);
    }
    selected_ids = next;
    last_selected_id = items[items.length - 1].id;
    last_selected_column = column_id;
    doRender();
  }

  /**
   * @param {string} column_id
   * @returns {IssueLite[]}
   */
  function getColumnItems(column_id) {
    if (column_id === 'blocked-col') {
      return list_blocked;
    }
    if (column_id === 'ready-col') {
      return list_ready;
    }
    if (column_id === 'in-progress-col') {
      return list_in_progress;
    }
    if (column_id === 'closed-col') {
      return list_closed;
    }
    return [];
  }

  /**
   * @param {string} column_id
   * @param {string} id
   * @returns {void}
   */
  function selectRange(column_id, id) {
    const items = getColumnItems(column_id);
    if (items.length === 0) {
      return;
    }
    let start_id = id;
    if (last_selected_id && last_selected_column === column_id) {
      start_id = last_selected_id;
    }
    const start_index = items.findIndex((item) => item.id === start_id);
    const end_index = items.findIndex((item) => item.id === id);
    if (start_index < 0 || end_index < 0) {
      toggleSelect(id, column_id);
      return;
    }
    const from = Math.min(start_index, end_index);
    const to = Math.max(start_index, end_index);
    /** @type {Set<string>} */
    const next = new Set(selected_ids);
    for (let i = from; i <= to; i += 1) {
      next.add(items[i].id);
    }
    selected_ids = next;
    last_selected_id = id;
    last_selected_column = column_id;
    doRender();
  }

  /**
   * @returns {Promise<void>}
   */
  async function deleteSelected() {
    if (selected_ids.size === 0) {
      return;
    }
    if (!transport) {
      showToast('Удаление недоступно', 'error', 3000);
      return;
    }
    const confirmed = window.confirm(
      `Удалить выбранные задачи (${selected_ids.size})?`
    );
    if (!confirmed) {
      return;
    }
    const ids = Array.from(selected_ids);
    try {
      await transport('delete-issues', { ids });
      showToast('Задачи удалены', 'success', 2400);
      clearSelection();
    } catch {
      showToast('Не удалось удалить задачи', 'error', 3200);
    }
  }

  /**
   * Handle drag start: store issue id in dataTransfer and add dragging class.
   *
   * @param {DragEvent} ev
   * @param {string} id
   */
  function onDragStart(ev, id) {
    dragging_id = id;
    if (ev.dataTransfer) {
      ev.dataTransfer.setData('text/plain', id);
      ev.dataTransfer.effectAllowed = 'move';
    }
    const target = /** @type {HTMLElement} */ (ev.target);
    target.classList.add('board-card--dragging');
    log('dragstart %s', id);
  }

  /**
   * Handle drag end: remove dragging class.
   *
   * @param {DragEvent} ev
   */
  function onDragEnd(ev) {
    const target = /** @type {HTMLElement} */ (ev.target);
    target.classList.remove('board-card--dragging');
    // Clear any highlighted drop target
    clearDropTarget();
    // Clear dragging_id after a short delay to allow click event to check it
    setTimeout(() => {
      dragging_id = null;
    }, 0);
    log('dragend');
  }

  /**
   * Clear the currently highlighted drop target column.
   */
  function clearDropTarget() {
    /** @type {HTMLElement[]} */
    const all_cols = Array.from(
      mount_element.querySelectorAll('.board-column--drag-over')
    );
    for (const c of all_cols) {
      c.classList.remove('board-column--drag-over');
    }
  }

  /**
   * Update issue status via WebSocket transport.
   *
   * @param {string} issue_id
   * @param {'open'|'in_progress'|'closed'} new_status
   */
  async function updateIssueStatus(issue_id, new_status) {
    if (!transport) {
      log('no transport available, status update skipped');
      showToast('Cannot update status: not connected', 'error');
      return;
    }
    try {
      log('update-status %s → %s', issue_id, new_status);
      await transport('update-status', { id: issue_id, status: new_status });
      showToast('Status updated', 'success', 1500);
    } catch (err) {
      log('update-status failed: %o', err);
      showToast('Failed to update status', 'error');
    }
  }

  function doRender() {
    render(template(), mount_element);
    postRenderEnhance();
  }

  /**
   * Enhance rendered board with a11y and keyboard navigation.
   * - Roving tabindex per column (first card tabbable).
   * - ArrowUp/ArrowDown within column.
   * - ArrowLeft/ArrowRight to adjacent non-empty column (focus top card).
   * - Enter/Space to open details for focused card.
   */
  function postRenderEnhance() {
    try {
      /** @type {HTMLElement[]} */
      const columns = Array.from(
        mount_element.querySelectorAll('.board-column')
      );
      for (const col of columns) {
        const body = /** @type {HTMLElement|null} */ (
          col.querySelector('.board-column__body')
        );
        if (!body) {
          continue;
        }
        /** @type {HTMLElement[]} */
        const cards = Array.from(body.querySelectorAll('.board-card'));
        // Assign aria-label using column header for screen readers
        const header = /** @type {HTMLElement|null} */ (
          col.querySelector('.board-column__header')
        );
        const col_name = header ? header.textContent?.trim() || '' : '';
        for (const card of cards) {
          const title_el = /** @type {HTMLElement|null} */ (
            card.querySelector('.board-card__title')
          );
          const t = title_el ? title_el.textContent?.trim() || '' : '';
          card.setAttribute(
            'aria-label',
            `Issue ${t || '(no title)'} — Column ${col_name}`
          );
          // Default roving setup
          card.tabIndex = -1;
        }
        if (cards.length > 0) {
          cards[0].tabIndex = 0;
        }
      }
    } catch {
      // non-fatal
    }
  }

  /**
   * @returns {void}
   */
  function openImportDialog() {
    import_dialog.open();
  }

  // Delegate keyboard handling from mount_element
  mount_element.addEventListener('keydown', (ev) => {
    const target = ev.target;
    if (!target || !(target instanceof HTMLElement)) {
      return;
    }
    // Do not intercept keys inside editable controls
    const tag = String(target.tagName || '').toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      target.isContentEditable === true
    ) {
      return;
    }
    const key_value = String(ev.key || '').toLowerCase();
    const has_ctrl = ev.metaKey || ev.ctrlKey;
    if (has_ctrl && key_value === 'a') {
      const card = target.closest('.board-card');
      if (card) {
        ev.preventDefault();
        const column = /** @type {HTMLElement|null} */ (
          card.closest('.board-column')
        );
        const column_id = column ? column.id : '';
        if (column_id) {
          selectAllInColumn(column_id);
        }
      }
      return;
    }
    const card = target.closest('.board-card');
    if (!card) {
      return;
    }
    const key = String(ev.key || '');
    if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      const id = card.getAttribute('data-issue-id');
      if (id) {
        gotoIssue(id);
      }
      return;
    }
    if (
      key !== 'ArrowUp' &&
      key !== 'ArrowDown' &&
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight'
    ) {
      return;
    }
    ev.preventDefault();
    // Column context
    const col = /** @type {HTMLElement|null} */ (card.closest('.board-column'));
    if (!col) {
      return;
    }
    const body = col.querySelector('.board-column__body');
    if (!body) {
      return;
    }
    /** @type {HTMLElement[]} */
    const cards = Array.from(body.querySelectorAll('.board-card'));
    const idx = cards.indexOf(/** @type {HTMLElement} */ (card));
    if (idx === -1) {
      return;
    }
    if (key === 'ArrowDown' && idx < cards.length - 1) {
      moveFocus(cards[idx], cards[idx + 1]);
      return;
    }
    if (key === 'ArrowUp' && idx > 0) {
      moveFocus(cards[idx], cards[idx - 1]);
      return;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      // Find adjacent column with at least one card
      /** @type {HTMLElement[]} */
      const cols = Array.from(mount_element.querySelectorAll('.board-column'));
      const col_idx = cols.indexOf(col);
      if (col_idx === -1) {
        return;
      }
      const dir = key === 'ArrowRight' ? 1 : -1;
      let next_idx = col_idx + dir;
      /** @type {HTMLElement|null} */
      let target_col = null;
      while (next_idx >= 0 && next_idx < cols.length) {
        const candidate = cols[next_idx];
        const c_body = /** @type {HTMLElement|null} */ (
          candidate.querySelector('.board-column__body')
        );
        const c_cards = c_body
          ? Array.from(c_body.querySelectorAll('.board-card'))
          : [];
        if (c_cards.length > 0) {
          target_col = candidate;
          break;
        }
        next_idx += dir;
      }
      if (target_col) {
        const first = /** @type {HTMLElement|null} */ (
          target_col.querySelector('.board-column__body .board-card')
        );
        if (first) {
          moveFocus(/** @type {HTMLElement} */ (card), first);
        }
      }
      return;
    }
  });

  // Track the currently highlighted column to avoid flicker
  /** @type {HTMLElement|null} */
  let current_drop_target = null;

  // Delegate drag and drop handling for columns
  mount_element.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'move';
    }
    // Find the column being dragged over
    const target = /** @type {HTMLElement} */ (ev.target);
    const col = /** @type {HTMLElement|null} */ (
      target.closest('.board-column')
    );

    // Only update if we've entered a different column
    if (col && col !== current_drop_target) {
      // Remove highlight from previous column
      if (current_drop_target) {
        current_drop_target.classList.remove('board-column--drag-over');
      }
      // Highlight the new column
      col.classList.add('board-column--drag-over');
      current_drop_target = col;
    }
  });

  mount_element.addEventListener('dragleave', (ev) => {
    const related = /** @type {HTMLElement|null} */ (ev.relatedTarget);
    // Only clear if we're leaving the mount element entirely
    if (!related || !mount_element.contains(related)) {
      if (current_drop_target) {
        current_drop_target.classList.remove('board-column--drag-over');
        current_drop_target = null;
      }
    }
  });

  mount_element.addEventListener('drop', (ev) => {
    ev.preventDefault();
    // Clear the drop target highlight
    if (current_drop_target) {
      current_drop_target.classList.remove('board-column--drag-over');
      current_drop_target = null;
    }

    const target = /** @type {HTMLElement} */ (ev.target);
    const col = target.closest('.board-column');
    if (!col) {
      return;
    }

    const col_id = col.id;
    const new_status = COLUMN_STATUS_MAP[col_id];
    if (!new_status) {
      log('drop on unknown column: %s', col_id);
      return;
    }

    const issue_id = ev.dataTransfer?.getData('text/plain');
    if (!issue_id) {
      log('drop without issue id');
      return;
    }

    log('drop %s on %s → %s', issue_id, col_id, new_status);
    void updateIssueStatus(issue_id, new_status);
  });

  /**
   * @param {HTMLElement} from
   * @param {HTMLElement} to
   */
  function moveFocus(from, to) {
    try {
      from.tabIndex = -1;
      to.tabIndex = 0;
      to.focus();
    } catch {
      // ignore focus errors
    }
  }

  // Sort helpers centralized in app/data/sort.js

  /**
   * Recompute closed list from raw using the current filter and sort.
   */
  function applyClosedFilter() {
    log('applyClosedFilter %s', closed_filter_mode);
    /** @type {IssueLite[]} */
    let items = Array.isArray(list_closed_raw) ? [...list_closed_raw] : [];
    const now = new Date();
    let since_ts = 0;
    if (closed_filter_mode === 'today') {
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0
      );
      since_ts = start.getTime();
    } else if (closed_filter_mode === '3') {
      since_ts = now.getTime() - 3 * 24 * 60 * 60 * 1000;
    } else if (closed_filter_mode === '7') {
      since_ts = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    }
    items = items.filter((it) => {
      const s = Number.isFinite(it.closed_at)
        ? /** @type {number} */ (it.closed_at)
        : NaN;
      if (!Number.isFinite(s)) {
        return false;
      }
      return s >= since_ts;
    });
    items.sort(cmpClosedDesc);
    list_closed = items;
  }

  /**
   * @param {Event} ev
   */
  function onClosedFilterChange(ev) {
    try {
      const el = /** @type {HTMLSelectElement} */ (ev.target);
      const v = String(el.value || 'today');
      closed_filter_mode = v === '3' || v === '7' ? v : 'today';
      log('closed filter %s', closed_filter_mode);
      if (store) {
        try {
          store.setState({ board: { closed_filter: closed_filter_mode } });
        } catch {
          // ignore store errors
        }
      }
      applyClosedFilter();
      doRender();
    } catch {
      // ignore
    }
  }

  /**
   * Compose lists from subscriptions + issues store and render.
   */
  function refreshFromStores() {
    try {
      if (selectors) {
        const in_progress = selectors.selectBoardColumn(
          'tab:board:in-progress',
          'in_progress'
        );
        const blocked = selectors.selectBoardColumn(
          'tab:board:blocked',
          'blocked'
        );
        const ready_raw = selectors.selectBoardColumn(
          'tab:board:ready',
          'ready'
        );
        const closed = selectors.selectBoardColumn(
          'tab:board:closed',
          'closed'
        );

        // Ready excludes items that are in progress
        /** @type {Set<string>} */
        const in_prog_ids = new Set(in_progress.map((i) => i.id));
        const ready = ready_raw.filter((i) => !in_prog_ids.has(i.id));

        list_ready = ready;
        list_blocked = blocked;
        list_in_progress = in_progress;
        list_closed_raw = closed;
      }
      applyClosedFilter();
      pruneSelection();
      doRender();
    } catch {
      list_ready = [];
      list_blocked = [];
      list_in_progress = [];
      list_closed = [];
      pruneSelection();
      doRender();
    }
  }

  // Live updates: recompose on issue store envelopes
  if (selectors) {
    selectors.subscribe(() => {
      try {
        refreshFromStores();
      } catch {
        // ignore
      }
    });
  }

  return {
    async load() {
      // Compose lists from subscriptions + issues store
      log('load');
      refreshFromStores();
      // If nothing is present yet (e.g., immediately after switching back
      // to the Board and before list-delta arrives), fetch via data layer as
      // a fallback so the board is not empty on initial display.
      try {
        const has_subs = Boolean(subscriptions && subscriptions.selectors);
        /**
         * @param {string} id
         */
        const cnt = (id) => {
          if (!has_subs || !subscriptions) {
            return 0;
          }
          const sel = subscriptions.selectors;
          if (typeof sel.count === 'function') {
            return Number(sel.count(id) || 0);
          }
          try {
            const arr = sel.getIds(id);
            return Array.isArray(arr) ? arr.length : 0;
          } catch {
            return 0;
          }
        };
        const total_items =
          cnt('tab:board:ready') +
          cnt('tab:board:blocked') +
          cnt('tab:board:in-progress') +
          cnt('tab:board:closed');
        const data = /** @type {any} */ (_data);
        const can_fetch =
          data &&
          typeof data.getReady === 'function' &&
          typeof data.getBlocked === 'function' &&
          typeof data.getInProgress === 'function' &&
          typeof data.getClosed === 'function';
        if (total_items === 0 && can_fetch) {
          log('fallback fetch');
          /** @type {[IssueLite[], IssueLite[], IssueLite[], IssueLite[]]} */
          const [ready_raw, blocked_raw, in_prog_raw, closed_raw] =
            await Promise.all([
              data.getReady().catch(() => []),
              data.getBlocked().catch(() => []),
              data.getInProgress().catch(() => []),
              data.getClosed().catch(() => [])
            ]);
          // Normalize and map unknowns to IssueLite shape
          /** @type {IssueLite[]} */
          let ready = Array.isArray(ready_raw) ? ready_raw.map((it) => it) : [];
          /** @type {IssueLite[]} */
          const blocked = Array.isArray(blocked_raw)
            ? blocked_raw.map((it) => it)
            : [];
          /** @type {IssueLite[]} */
          const in_prog = Array.isArray(in_prog_raw)
            ? in_prog_raw.map((it) => it)
            : [];
          /** @type {IssueLite[]} */
          const closed = Array.isArray(closed_raw)
            ? closed_raw.map((it) => it)
            : [];

          // Remove items from Ready that are already In Progress
          /** @type {Set<string>} */
          const in_progress_ids = new Set(in_prog.map((i) => i.id));
          ready = ready.filter((i) => !in_progress_ids.has(i.id));

          // Sort as per column rules
          ready.sort(cmpPriorityThenCreated);
          blocked.sort(cmpPriorityThenCreated);
          in_prog.sort(cmpPriorityThenCreated);
          list_ready = ready;
          list_blocked = blocked;
          list_in_progress = in_prog;
          list_closed_raw = closed;
          applyClosedFilter();
          pruneSelection();
          doRender();
        }
      } catch {
        // ignore fallback errors
      }
    },
    clear() {
      mount_element.replaceChildren();
      list_ready = [];
      list_blocked = [];
      list_in_progress = [];
      list_closed = [];
      selected_ids = new Set();
      last_selected_id = null;
      last_selected_column = null;
      import_dialog.destroy();
    }
  };
}
