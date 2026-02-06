import { html, render } from 'lit-html';
import {
  fetchIntegrationColumnsForBoard,
  fetchIntegrationTaskSearch,
  fetchIntegrationsStatus,
  moveIntegrationTask
} from '../data/import.js';
import { debug } from '../utils/logging.js';
import { showToast } from '../utils/toast.js';

/**
 * @typedef {{ id: string, name: string, connected: boolean }} IntegrationOption
 * @typedef {{ id: string, title: string, board_id: string }} ColumnOption
 * @typedef {{ id: string, title: string, link: string, column_title: string, column_id: string, board_id: string }} TaskSearchResult
 */

/**
 * Create Task Search dialog.
 *
 * @returns {{ open: () => void, destroy: () => void }}
 */
export function createTaskSearchDialog() {
  const log = debug('views:task-search-dialog');
  const dialog = /** @type {HTMLDialogElement} */ (
    document.createElement('dialog')
  );
  dialog.id = 'task-search-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.appendChild(dialog);
  /** @type {string} */
  let pending_task_id = '';
  /** @type {string} */
  let pending_task_link = '';

  /** @type {{ loading: boolean, integrations: IntegrationOption[], columns: ColumnOption[], selected_integration: string, selected_column: string, task_id: string, task_link: string, task_title: string, task_column_title: string, search_loading: boolean, move_loading: boolean, search_result: TaskSearchResult | null, search_error: string, move_message: string }} */
  let view_state = {
    loading: false,
    integrations: [],
    columns: [],
    selected_integration: '',
    selected_column: '',
    task_id: '',
    task_link: '',
    task_title: '',
    task_column_title: '',
    search_loading: false,
    move_loading: false,
    search_result: null,
    search_error: '',
    move_message: ''
  };

  /**
   * @param {Partial<typeof view_state>} patch
   */
  function setState(patch) {
    view_state = { ...view_state, ...patch };
    renderDialog();
  }

  /**
   * @returns {void}
   */
  function open() {
    renderDialog();
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
    void loadIntegrations();
  }

  /**
   * @param {string} task_id
   * @returns {void}
   */
  function openWithTaskId(task_id, task_link = '') {
    pending_task_id = String(task_id || '');
    pending_task_link = String(task_link || '');
    open();
  }

  /**
   * @returns {void}
   */
  function close() {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /**
   * @returns {void}
   */
  function destroy() {
    dialog.remove();
  }

  dialog.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    close();
  });
  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) {
      close();
    }
  });

  /**
   * @returns {Promise<void>}
   */
  async function loadIntegrations() {
    setState({
      loading: true,
      integrations: [],
      columns: [],
      selected_integration: '',
      selected_column: '',
      task_id: pending_task_id,
      task_link: pending_task_link,
      task_title: '',
      task_column_title: '',
      search_loading: false,
      move_loading: false,
      search_result: null,
      search_error: '',
      move_message: ''
    });
    pending_task_id = '';
    pending_task_link = '';
    try {
      const result = await fetchIntegrationsStatus();
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        setState({ loading: false });
        if (!result.ok) {
          showToast(
            extractErrorMessage(result.data) ||
              'Не удалось загрузить интеграции',
            'error',
            3400
          );
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const integrations_raw = Array.isArray(data.integrations)
        ? data.integrations
        : [];
      const statuses_raw = Array.isArray(data.statuses) ? data.statuses : [];
      const status_map = new Map(
        statuses_raw.map((status) => [
          String(status.id || ''),
          Boolean(status.connected)
        ])
      );
      const integrations = integrations_raw
        .map((item) => {
          const any = /** @type {any} */ (item);
          const id = String(any.id || '');
          return {
            id,
            name: String(any.name || id),
            connected: status_map.get(id) === true
          };
        })
        .filter((it) => it.id.length > 0);
      const connected = integrations.filter((it) => it.connected);
      const selected_integration =
        connected.length === 1 ? connected[0].id : '';
      setState({
        loading: false,
        integrations,
        selected_integration
      });
      if (selected_integration && pending_task_id) {
        void loadTaskContext(selected_integration, pending_task_id);
      }
    } catch (err) {
      log('load integrations failed: %o', err);
      setState({ loading: false });
    }
  }

  /**
   * @param {Event} ev
   * @returns {void}
   */
  function onIntegrationChange(ev) {
    const select = /** @type {HTMLSelectElement} */ (ev.target);
    const integration_id = String(select.value || '');
    setState({
      selected_integration: integration_id,
      columns: [],
      selected_column: '',
      search_result: null,
      search_error: '',
      move_message: ''
    });
    if (integration_id && view_state.task_id) {
      void loadTaskContext(integration_id, view_state.task_id);
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async function loadTaskContext(integration_id, task_id) {
    const trimmed_id = String(task_id || '').trim();
    if (!integration_id || !trimmed_id) {
      return;
    }
    setState({
      search_loading: true,
      search_result: null,
      search_error: '',
      move_message: ''
    });
    try {
      const result = await fetchIntegrationTaskSearch(integration_id, {
        task_id: trimmed_id
      });
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        setState({ search_loading: false });
        if (!result.ok) {
          const message =
            extractErrorMessage(result.data) || 'Не удалось найти задачу';
          setState({ search_error: message });
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const task = data.task || null;
      if (!task) {
        setState({
          search_loading: false,
          search_result: null,
          search_error: 'Задача не найдена'
        });
        return;
      }
      const task_result = {
        id: String(task.id || ''),
        title: String(task.title || ''),
        link: String(task.link || ''),
        column_title: String(task.column_title || ''),
        column_id: String(task.column_id || ''),
        board_id: String(task.board_id || '')
      };
      let columns = [];
      if (task_result.board_id) {
        columns = await loadColumns(integration_id, task_result.board_id);
      }
      setState({
        search_loading: false,
        search_result: task_result,
        columns: columns.length > 0 ? columns : view_state.columns,
        selected_column: task_result.column_id || '',
        task_title: task_result.title || '',
        task_column_title: task_result.column_title || '',
        task_link: view_state.task_link || task_result.link || ''
      });
    } catch (err) {
      log('task load failed: %o', err);
      setState({
        search_loading: false,
        search_error: 'Ошибка загрузки задачи',
        move_message: ''
      });
    }
  }

  /**
   * @param {string} integration_id
   * @param {string} board_id
   * @returns {Promise<void>}
   */
  async function loadColumns(integration_id, board_id) {
    try {
      const result = await fetchIntegrationColumnsForBoard(
        integration_id,
        board_id
      );
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        if (!result.ok) {
          showToast(
            extractErrorMessage(result.data) || 'Не удалось загрузить колонки',
            'error',
            3400
          );
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const columns_raw = Array.isArray(data.columns) ? data.columns : [];
      const columns = columns_raw
        .map((item) => ({
          id: String(item.id || ''),
          title: String(item.title || ''),
          board_id: String(item.board_id || '')
        }))
        .filter((column) => column.id.length > 0);
      setState({ columns });
      return columns;
    } catch (err) {
      log('load columns failed: %o', err);
      return [];
    }
  }

  /**
   * @param {Event} ev
   * @returns {void}
   */
  function onColumnChange(ev) {
    const select = /** @type {HTMLSelectElement} */ (ev.target);
    setState({
      selected_column: String(select.value || ''),
      move_message: ''
    });
  }

  /**
   * @returns {Promise<void>}
   */
  async function moveTask() {
    if (!view_state.selected_integration) {
      showToast('Выберите интеграцию', 'error', 2600);
      return;
    }
    if (!view_state.search_result) {
      showToast('Задача не загружена', 'error', 2600);
      return;
    }
    if (!view_state.selected_column) {
      showToast('Выберите колонку', 'error', 2600);
      return;
    }
    setState({ move_loading: true, move_message: '' });
    try {
      const result = await moveIntegrationTask(
        view_state.selected_integration,
        {
          task_id: view_state.search_result.id,
          column_id: view_state.selected_column
        }
      );
      if (!result.ok) {
        const message =
          extractErrorMessage(result.data) || 'Не удалось переместить задачу';
        setState({ move_loading: false, move_message: message });
        return;
      }
      const column_title = resolveColumnTitle(
        view_state.columns,
        view_state.selected_column
      );
      setState({
        move_loading: false,
        move_message: 'Задача перемещена',
        search_result: {
          ...view_state.search_result,
          column_id: view_state.selected_column,
          column_title
        }
      });
    } catch (err) {
      log('move task failed: %o', err);
      setState({
        move_loading: false,
        move_message: 'Ошибка перемещения задачи'
      });
    }
  }

  /**
   * @param {ColumnOption[]} columns
   * @param {string} column_id
   * @returns {string}
   */
  function resolveColumnTitle(columns, column_id) {
    const match = columns.find((column) => column.id === column_id);
    return match ? match.title || '' : '';
  }

  /**
   * @param {unknown} data
   * @returns {string}
   */
  function extractErrorMessage(data) {
    if (!data) {
      return '';
    }
    if (typeof data === 'string') {
      return data;
    }
    if (typeof data === 'object' && data) {
      const any = /** @type {any} */ (data);
      if (typeof any.error === 'string') {
        return any.error;
      }
      if (any.error && typeof any.error.message === 'string') {
        return any.error.message;
      }
    }
    return '';
  }

  /**
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function renderDialog() {
    const connected_integrations = view_state.integrations.filter(
      (it) => it.connected
    );
    render(
      html`
        <div class="task-search-dialog">
          <header class="task-search-dialog__header">
            <div>
              <div class="task-search-dialog__kicker">Поиск задачи</div>
              <h3>Найти задачу по номеру</h3>
            </div>
            <button
              type="button"
              class="task-search-dialog__close"
              @click=${close}
            >
              ✕
            </button>
          </header>
          ${connected_integrations.length === 0
            ? html`
                <div class="task-search-dialog__empty">
                  Нет подключённых интеграций.
                </div>
              `
            : html`
                <div class="task-search-dialog__body">
                  ${connected_integrations.length > 1
                    ? html`
                        <label class="task-search-dialog__field">
                          <span>Интеграция</span>
                          <select @change=${onIntegrationChange}>
                            <option value="">Выберите интеграцию</option>
                            ${connected_integrations.map(
                              (integration) => html`
                                <option
                                  value=${integration.id}
                                  ?selected=${integration.id ===
                                  view_state.selected_integration}
                                >
                                  ${integration.name}
                                </option>
                              `
                            )}
                          </select>
                        </label>
                      `
                    : null}
                  <label class="task-search-dialog__field">
                    <span>Колонка</span>
                    <select @change=${onColumnChange}>
                      <option value="">Выберите колонку</option>
                      ${view_state.columns.map(
                        (column) => html`
                          <option
                            value=${column.id}
                            ?selected=${column.id ===
                            view_state.selected_column}
                          >
                            ${column.title || 'Колонка'}
                          </option>
                        `
                      )}
                    </select>
                  </label>
                  <div class="task-search-dialog__field">
                    <span>Задача</span>
                    <div class="task-search-dialog__task-meta">
                      <span class="mono">${view_state.task_id || '-'}</span>
                      ${view_state.task_title
                        ? html`<span>${view_state.task_title}</span>`
                        : null}
                    </div>
                  </div>
                  ${view_state.task_link
                    ? html`
                        <div class="task-search-dialog__actions">
                          <a
                            class="btn"
                            href=${view_state.task_link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Перейти к задаче
                          </a>
                        </div>
                      `
                    : null}
                  <div class="task-search-dialog__result">
                    ${view_state.search_loading
                      ? html`
                          <div class="task-search-dialog__empty">Загрузка…</div>
                        `
                      : view_state.search_error
                        ? html`
                            <div class="task-search-dialog__empty">
                              ${view_state.search_error}
                            </div>
                          `
                        : null}
                    <div class="task-search-dialog__actions">
                      <button
                        type="button"
                        class="btn"
                        ?disabled=${view_state.move_loading}
                        @click=${moveTask}
                      >
                        ${view_state.move_loading
                          ? 'Перемещаю…'
                          : 'Переместить в колонку'}
                      </button>
                      ${view_state.move_message
                        ? html`<span class="task-search-dialog__move-message">
                            ${view_state.move_message}
                          </span>`
                        : null}
                    </div>
                  </div>
                </div>
              `}
        </div>
      `,
      dialog
    );
  }

  return { open, openWithTaskId, destroy };
}
