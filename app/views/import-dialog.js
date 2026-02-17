import { html, render } from 'lit-html';
import {
  fetchIntegrationColumns,
  fetchIntegrationPreview,
  fetchIntegrationProjectsForTeam,
  fetchIntegrationStickers,
  fetchIntegrationTeams,
  fetchIntegrationUsers,
  fetchIntegrationsStatus,
  runImport,
  runTaskLinkImport
} from '../data/import.js';
import { debug } from '../utils/logging.js';
import { showToast } from '../utils/toast.js';

/**
 * @typedef {{ id: string, name: string, connected: boolean }} IntegrationOption
 * @typedef {{ id: string, title: string }} TeamOption
 * @typedef {{ id: string, title: string }} ProjectOption
 * @typedef {{ id: string, title: string, board_title?: string }} ColumnOption
 * @typedef {{ id: string, name: string }} UserOption
 * @typedef {{ id: string, title: string, values: Array<{ id: string, title: string }> }} StickerOption
 * @typedef {{ id: string, title: string, column_id: string, description: string, link: string, body: string }} PreviewTask
 */

const steps = [
  { id: 'source', title: 'Источник' },
  { id: 'structure', title: 'Колонки' },
  { id: 'filters', title: 'Фильтры' },
  { id: 'preview', title: 'Превью' }
];

/**
 * Create Import Tasks dialog.
 *
 * @returns {{ open: () => void, destroy: () => void }}
 */
export function createImportDialog() {
  const log = debug('views:import-dialog');
  const dialog = /** @type {HTMLDialogElement} */ (
    document.createElement('dialog')
  );
  dialog.id = 'import-tasks-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.appendChild(dialog);

  /** @type {{ loading: boolean, step_index: number, integrations: IntegrationOption[], teams: TeamOption[], projects: ProjectOption[], columns: ColumnOption[], users: UserOption[], stickers: StickerOption[], preview_tasks: PreviewTask[], preview_task: PreviewTask | null, preview_loading: boolean, selected_integration: string, selected_team: string, selected_project: string, selected_columns: Set<string>, selected_users: Set<string>, selected_sticker_values: Set<string>, selected_task_ids: Set<string>, quick_task_input: string, quick_import_loading: boolean }} */
  let view_state = {
    loading: false,
    step_index: 0,
    integrations: [],
    teams: [],
    projects: [],
    columns: [],
    users: [],
    stickers: [],
    preview_tasks: [],
    preview_task: null,
    preview_loading: false,
    selected_integration: '',
    selected_team: '',
    selected_project: '',
    selected_columns: new Set(),
    selected_users: new Set(),
    selected_sticker_values: new Set(),
    selected_task_ids: new Set(),
    quick_task_input: '',
    quick_import_loading: false
  };

  /** @type {string} */
  let last_preview_key = '';

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
   * @returns {void}
   */
  function close() {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
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
      step_index: 0,
      integrations: [],
      teams: [],
      projects: [],
      columns: [],
      users: [],
      stickers: [],
      preview_tasks: [],
      preview_task: null,
      preview_loading: false,
      selected_integration: '',
      selected_team: '',
      selected_project: '',
      selected_columns: new Set(),
      selected_users: new Set(),
      selected_sticker_values: new Set(),
      selected_task_ids: new Set(),
      quick_task_input: '',
      quick_import_loading: false
    });
    last_preview_key = '';
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
      const registry = Array.isArray(data.integrations)
        ? data.integrations
        : [];
      const statuses = Array.isArray(data.statuses) ? data.statuses : [];
      /** @type {Map<string, boolean>} */
      const connected_by_id = new Map();
      for (const status of statuses) {
        if (!status || typeof status !== 'object') {
          continue;
        }
        const id = String(/** @type {any} */ (status).id || '');
        if (!id) {
          continue;
        }
        connected_by_id.set(id, Boolean(/** @type {any} */ (status).connected));
      }
      const integrations = registry
        .map((/** @type {any} */ item) => {
          const any = /** @type {any} */ (item);
          const id = String(any.id || '');
          return {
            id,
            name: String(any.name || id),
            connected: connected_by_id.get(id) === true
          };
        })
        .filter((/** @type {IntegrationOption} */ item) => item.id.length > 0);
      const connected = integrations.filter(
        (/** @type {IntegrationOption} */ item) => item.connected
      );
      const selected_integration =
        connected.length === 1 ? connected[0].id : '';
      setState({
        loading: false,
        integrations,
        selected_integration
      });
      if (selected_integration) {
        void loadTeams(selected_integration);
      }
    } catch (err) {
      log('load integrations failed: %o', err);
      setState({ loading: false });
    }
  }

  /**
   * @param {string} integration_id
   * @returns {Promise<void>}
   */
  async function loadTeams(integration_id) {
    setState({
      loading: true,
      teams: [],
      selected_team: '',
      projects: [],
      selected_project: '',
      columns: [],
      selected_columns: new Set(),
      users: [],
      selected_users: new Set(),
      stickers: [],
      selected_sticker_values: new Set()
    });
    try {
      const result = await fetchIntegrationTeams(integration_id);
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        setState({ loading: false, teams: [] });
        if (!result.ok) {
          showToast(
            extractErrorMessage(result.data) || 'Не удалось загрузить команды',
            'error',
            3400
          );
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const teams_raw = Array.isArray(data.teams) ? data.teams : [];
      const teams = teams_raw
        .map((/** @type {any} */ item) => {
          const any = /** @type {any} */ (item);
          return {
            id: String(any.id || ''),
            title: String(any.title || any.name || '')
          };
        })
        .filter((/** @type {TeamOption} */ item) => item.id.length > 0);
      setState({ loading: false, teams });
      if (teams.length === 0) {
        void loadProjects(integration_id, '');
      }
    } catch (err) {
      log('load teams failed: %o', err);
      setState({ loading: false, teams: [] });
    }
  }

  /**
   * @param {string} integration_id
   * @param {string} team_id
   * @returns {Promise<void>}
   */
  async function loadProjects(integration_id, team_id) {
    setState({
      loading: true,
      projects: [],
      selected_project: '',
      columns: [],
      selected_columns: new Set(),
      users: [],
      selected_users: new Set(),
      stickers: [],
      selected_sticker_values: new Set()
    });
    try {
      const result = await fetchIntegrationProjectsForTeam(
        integration_id,
        team_id
      );
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        setState({ loading: false, projects: [] });
        if (!result.ok) {
          showToast(
            extractErrorMessage(result.data) || 'Не удалось загрузить проекты',
            'error',
            3400
          );
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const projects_raw = Array.isArray(data.projects) ? data.projects : [];
      const projects = projects_raw
        .map((/** @type {any} */ item) => {
          const any = /** @type {any} */ (item);
          return {
            id: String(any.id || ''),
            title: String(any.title || any.name || '')
          };
        })
        .filter((/** @type {ProjectOption} */ item) => item.id.length > 0);
      setState({ loading: false, projects });
    } catch (err) {
      log('load projects failed: %o', err);
      setState({ loading: false, projects: [] });
    }
  }

  /**
   * @param {string} integration_id
   * @param {string} project_id
   * @returns {Promise<void>}
   */
  /**
   * @param {string} integration_id
   * @param {string} project_id
   * @returns {Promise<void>}
   */
  async function loadColumns(integration_id, project_id) {
    setState({ loading: true, columns: [], selected_columns: new Set() });
    try {
      const result = await fetchIntegrationColumns(integration_id, project_id);
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        setState({ loading: false, columns: [] });
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
        .map((/** @type {any} */ item) => {
          const any = /** @type {any} */ (item);
          return {
            id: String(any.id || ''),
            title: String(any.title || any.name || ''),
            board_title: String(any.board_title || '')
          };
        })
        .filter((/** @type {ColumnOption} */ item) => item.id.length > 0);
      setState({ loading: false, columns });
    } catch (err) {
      log('load columns failed: %o', err);
      setState({ loading: false, columns: [] });
    }
  }

  /**
   * @param {string} integration_id
   * @param {string} project_id
   * @returns {Promise<void>}
   */
  async function loadFilters(integration_id, project_id) {
    await Promise.all([
      loadUsers(integration_id, project_id),
      loadStickers(integration_id)
    ]);
  }

  /**
   * @param {string} integration_id
   * @param {string} project_id
   * @returns {Promise<void>}
   */
  async function loadUsers(integration_id, project_id) {
    try {
      const result = await fetchIntegrationUsers(integration_id, project_id);
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        if (!result.ok) {
          showToast(
            extractErrorMessage(result.data) ||
              'Не удалось загрузить исполнителей',
            'error',
            3400
          );
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const users_raw = Array.isArray(data.users) ? data.users : [];
      const users = users_raw
        .map((/** @type {any} */ item) => {
          const any = /** @type {any} */ (item);
          return {
            id: String(any.id || ''),
            name: String(any.name || any.title || '')
          };
        })
        .filter((/** @type {UserOption} */ item) => item.id.length > 0);
      setState({ users });
    } catch (err) {
      log('load users failed: %o', err);
    }
  }

  /**
   * @param {string} integration_id
   * @returns {Promise<void>}
   */
  async function loadStickers(integration_id) {
    try {
      const result = await fetchIntegrationStickers(integration_id);
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        if (!result.ok) {
          showToast(
            extractErrorMessage(result.data) || 'Не удалось загрузить стикеры',
            'error',
            3400
          );
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const stickers_raw = Array.isArray(data.stickers) ? data.stickers : [];
      const stickers = stickers_raw
        .map((/** @type {any} */ item) => {
          const any = /** @type {any} */ (item);
          const values_raw = Array.isArray(any.values) ? any.values : [];
          return {
            id: String(any.id || ''),
            title: String(any.title || ''),
            values: values_raw
              .map((/** @type {any} */ val) => ({
                id: String(val.id || ''),
                title: String(val.title || '')
              }))
              .filter((/** @type {{ id: string }} */ val) => val.id.length > 0)
          };
        })
        .filter((/** @type {StickerOption} */ item) => item.id.length > 0);
      setState({ stickers });
    } catch (err) {
      log('load stickers failed: %o', err);
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async function loadPreview() {
    const selected_columns = getEffectiveColumnIds();
    const selected_users = Array.from(view_state.selected_users);
    const selected_stickers = Array.from(view_state.selected_sticker_values);
    if (selected_columns.length === 0 || !view_state.selected_integration) {
      setState({
        preview_tasks: [],
        preview_task: null,
        preview_loading: false,
        selected_task_ids: new Set()
      });
      return;
    }
    const key = buildPreviewKey(
      selected_columns,
      selected_users,
      selected_stickers
    );
    if (key === last_preview_key) {
      return;
    }
    last_preview_key = key;
    setState({
      preview_loading: true,
      preview_tasks: [],
      preview_task: null,
      selected_task_ids: new Set()
    });
    try {
      const result = await fetchIntegrationPreview(
        view_state.selected_integration,
        {
          column_ids: selected_columns,
          assignee_ids: selected_users,
          sticker_value_ids: selected_stickers
        }
      );
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        setState({
          preview_loading: false,
          preview_tasks: [],
          preview_task: null
        });
        if (!result.ok) {
          showToast(
            extractErrorMessage(result.data) || 'Не удалось загрузить превью',
            'error',
            3400
          );
        }
        return;
      }
      const data = /** @type {any} */ (result.data);
      const tasks_raw = Array.isArray(data.tasks) ? data.tasks : [];
      const tasks = tasks_raw
        .map((/** @type {any} */ task) => {
          const any = /** @type {any} */ (task);
          const id = String(any.id || '');
          const title = String(any.title || '');
          const column_id = String(any.column_id || '');
          const description = String(any.description || '');
          const link = String(any.link || '');
          const body =
            String(any.body || '') || buildPreviewBody(description, link);
          return {
            id,
            title,
            column_id,
            description,
            link,
            body
          };
        })
        .filter((/** @type {PreviewTask} */ task) => task.id.length > 0);
      const selected_task_ids = deriveSelectedTaskIds(
        tasks,
        view_state.selected_task_ids
      );
      setState({
        preview_loading: false,
        preview_tasks: tasks,
        selected_task_ids
      });
    } catch (err) {
      log('load preview failed: %o', err);
      setState({
        preview_loading: false,
        preview_tasks: [],
        preview_task: null,
        selected_task_ids: new Set()
      });
    }
  }

  /**
   * @param {PreviewTask[]} tasks
   * @param {Set<string>} previous_selected
   * @returns {Set<string>}
   */
  function deriveSelectedTaskIds(tasks, previous_selected) {
    if (tasks.length === 0) {
      return new Set();
    }
    if (previous_selected.size === 0) {
      return new Set(tasks.map((task) => task.id));
    }
    /** @type {Set<string>} */
    const next = new Set();
    for (const task of tasks) {
      if (previous_selected.has(task.id)) {
        next.add(task.id);
      }
    }
    if (next.size > 0) {
      return next;
    }
    return new Set(tasks.map((task) => task.id));
  }

  /**
   * @param {string} task_id
   * @returns {void}
   */
  function toggleTaskSelection(task_id) {
    /** @type {Set<string>} */
    const next = new Set(view_state.selected_task_ids);
    if (next.has(task_id)) {
      next.delete(task_id);
    } else {
      next.add(task_id);
    }
    setState({ selected_task_ids: next });
  }

  /**
   * @returns {void}
   */
  function selectAllTasks() {
    if (view_state.preview_tasks.length === 0) {
      return;
    }
    setState({
      selected_task_ids: new Set(
        view_state.preview_tasks.map((task) => task.id)
      )
    });
  }

  /**
   * @returns {void}
   */
  function clearSelectedTasks() {
    setState({ selected_task_ids: new Set() });
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
      selected_team: '',
      selected_project: '',
      projects: [],
      teams: [],
      columns: [],
      selected_columns: new Set(),
      users: [],
      selected_users: new Set(),
      stickers: [],
      selected_sticker_values: new Set(),
      preview_tasks: [],
      preview_task: null,
      selected_task_ids: new Set(),
      quick_task_input: '',
      quick_import_loading: false
    });
    last_preview_key = '';
    if (integration_id) {
      void loadTeams(integration_id);
    }
  }

  /**
   * @param {Event} ev
   * @returns {void}
   */
  function onTeamChange(ev) {
    const select = /** @type {HTMLSelectElement} */ (ev.target);
    const team_id = String(select.value || '');
    setState({
      selected_team: team_id,
      selected_project: '',
      projects: [],
      columns: [],
      selected_columns: new Set(),
      users: [],
      selected_users: new Set(),
      stickers: [],
      selected_sticker_values: new Set(),
      preview_tasks: [],
      preview_task: null,
      selected_task_ids: new Set()
    });
    last_preview_key = '';
    if (team_id && view_state.selected_integration) {
      void loadProjects(view_state.selected_integration, team_id);
    }
  }

  /**
   * @param {Event} ev
   * @returns {void}
   */
  function onProjectChange(ev) {
    const select = /** @type {HTMLSelectElement} */ (ev.target);
    const project_id = String(select.value || '');
    setState({
      selected_project: project_id,
      columns: [],
      selected_columns: new Set(),
      users: [],
      selected_users: new Set(),
      stickers: [],
      selected_sticker_values: new Set(),
      preview_tasks: [],
      preview_task: null
    });
    last_preview_key = '';
    if (project_id && view_state.selected_integration) {
      void loadColumns(view_state.selected_integration, project_id);
      void loadFilters(view_state.selected_integration, project_id);
    }
  }

  /**
   * @param {Event} ev
   * @returns {void}
   */
  function onQuickTaskInputChange(ev) {
    const input = /** @type {HTMLInputElement} */ (ev.target);
    setState({ quick_task_input: String(input.value || '') });
  }

  /**
   * @param {KeyboardEvent} ev
   * @returns {void}
   */
  function onQuickTaskInputKeydown(ev) {
    if (ev.key !== 'Enter') {
      return;
    }
    ev.preventDefault();
    void runQuickTaskImport();
  }

  /**
   * @returns {Promise<void>}
   */
  async function runQuickTaskImport() {
    if (view_state.selected_integration !== 'yougile') {
      showToast(
        'Быстрый импорт по ссылке доступен только для Yougile',
        'error'
      );
      return;
    }
    const task_input = view_state.quick_task_input.trim();
    if (!task_input) {
      showToast('Вставьте ссылку на задачу Yougile', 'error', 2600);
      return;
    }
    setState({ quick_import_loading: true });
    try {
      const result = await runTaskLinkImport(view_state.selected_integration, {
        task_input
      });
      if (!result.ok || !result.data || typeof result.data !== 'object') {
        const message =
          extractErrorMessage(result.data) || 'Не удалось импортировать задачу';
        showToast(message, 'error', 3400);
        return;
      }
      const data = /** @type {{ created?: boolean, skipped?: boolean }} */ (
        result.data
      );
      if (data.skipped) {
        showToast('Задача уже импортирована', 'info', 3000);
      } else if (data.created) {
        showToast('Задача импортирована', 'success', 2600);
      } else {
        showToast('Импорт завершён', 'success', 2600);
      }
      close();
    } catch (err) {
      log('quick import failed: %o', err);
      showToast('Ошибка импорта', 'error', 3400);
    } finally {
      setState({ quick_import_loading: false });
    }
  }

  /**
   * @param {string} column_id
   * @returns {void}
   */
  function toggleColumn(column_id) {
    /** @type {Set<string>} */
    const next = new Set(view_state.selected_columns);
    if (next.has(column_id)) {
      next.delete(column_id);
    } else {
      next.add(column_id);
    }
    setState({ selected_columns: next });
    last_preview_key = '';
  }

  /**
   * @param {string} user_id
   * @returns {void}
   */
  function toggleUser(user_id) {
    /** @type {Set<string>} */
    const next = new Set(view_state.selected_users);
    if (next.has(user_id)) {
      next.delete(user_id);
    } else {
      next.add(user_id);
    }
    setState({ selected_users: next });
    last_preview_key = '';
  }

  /**
   * @param {string} value_id
   * @returns {void}
   */
  function toggleStickerValue(value_id) {
    /** @type {Set<string>} */
    const next = new Set(view_state.selected_sticker_values);
    if (next.has(value_id)) {
      next.delete(value_id);
    } else {
      next.add(value_id);
    }
    setState({ selected_sticker_values: next });
    last_preview_key = '';
  }

  /**
   * @returns {Promise<void>}
   */
  async function runSelectedImport() {
    const column_ids = getEffectiveColumnIds();
    if (!view_state.selected_integration || !view_state.selected_project) {
      showToast('Выберите проект', 'error', 2600);
      return;
    }
    if (column_ids.length === 0) {
      showToast('Нет колонок для импорта', 'error', 2600);
      return;
    }
    if (
      view_state.preview_tasks.length > 0 &&
      view_state.selected_task_ids.size === 0
    ) {
      showToast('Выберите задачи для импорта', 'error', 2600);
      return;
    }
    setState({ loading: true });
    try {
      const result = await runImport(view_state.selected_integration, {
        project_id: view_state.selected_project,
        team_id: view_state.selected_team,
        column_ids,
        assignee_ids: Array.from(view_state.selected_users),
        sticker_value_ids: Array.from(view_state.selected_sticker_values),
        task_ids: Array.from(view_state.selected_task_ids)
      });
      if (result.ok) {
        const data =
          result.data && typeof result.data === 'object'
            ? /** @type {{ created_count?: number, skipped_count?: number }} */ (
                result.data
              )
            : {};
        const created_count = Number(data.created_count || 0);
        const skipped_count = Number(data.skipped_count || 0);
        if (created_count > 0) {
          const suffix =
            skipped_count > 0 ? `, пропущено: ${skipped_count}` : '';
          showToast(
            `Импортировано: ${created_count}${suffix}`,
            'success',
            2800
          );
        } else if (skipped_count > 0) {
          showToast(
            `Новых задач нет, пропущено: ${skipped_count}`,
            'info',
            3200
          );
        } else {
          showToast('Импорт завершён', 'success', 2400);
        }
        close();
        return;
      }
      const message = extractErrorMessage(result.data);
      showToast(message || 'Не удалось запустить импорт', 'error', 3400);
    } catch (err) {
      log('import failed: %o', err);
      showToast('Ошибка импорта', 'error', 3400);
    } finally {
      setState({ loading: false });
    }
  }

  /**
   * @param {number} next_step
   * @returns {void}
   */
  function goToStep(next_step) {
    const step_index = Math.min(Math.max(next_step, 0), steps.length - 1);
    setState({ step_index });
    if (step_index === 2) {
      if (view_state.selected_integration && view_state.selected_project) {
        void loadFilters(
          view_state.selected_integration,
          view_state.selected_project
        );
      }
    }
    if (step_index === 3) {
      void loadPreview();
    }
  }

  /**
   * @returns {void}
   */
  function goNext() {
    if (!canProceed()) {
      return;
    }
    if (view_state.step_index < steps.length - 1) {
      goToStep(view_state.step_index + 1);
    }
  }

  /**
   * @returns {void}
   */
  function goBack() {
    if (view_state.step_index > 0) {
      goToStep(view_state.step_index - 1);
    }
  }

  /**
   * @returns {void}
   */
  function goSkip() {
    if (view_state.step_index === 2) {
      goToStep(3);
    }
  }

  /**
   * @returns {boolean}
   */
  function canProceed() {
    if (view_state.step_index === 0) {
      if (!view_state.selected_integration) {
        showToast('Выберите менеджер задач', 'error', 2400);
        return false;
      }
      if (view_state.teams.length > 0 && !view_state.selected_team) {
        showToast('Выберите команду', 'error', 2400);
        return false;
      }
      if (!view_state.selected_project) {
        showToast('Выберите проект', 'error', 2400);
        return false;
      }
      return true;
    }
    if (view_state.step_index === 1) {
      return true;
    }
    return true;
  }

  /**
   * @returns {void}
   */
  function renderDialog() {
    render(template(), dialog);
  }

  /**
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function template() {
    const connected = view_state.integrations.filter((i) => i.connected);
    const has_connected = connected.length > 0;
    const step = steps[view_state.step_index];
    return html`
      <div class="import-dialog">
        <header class="import-dialog__header">
          <div>
            <div class="import-dialog__kicker">Импорт задач</div>
            <h3>${step.title}</h3>
          </div>
          <button
            type="button"
            class="import-dialog__close"
            aria-label="Close"
            @click=${close}
          >
            ×
          </button>
        </header>
        <div class="import-dialog__steps">
          ${steps.map(
            (item, index) => html`
              <div
                class=${`import-dialog__step ${
                  index === view_state.step_index ? 'active' : ''
                }`}
              >
                <span>${index + 1}</span>
                <span>${item.title}</span>
              </div>
            `
          )}
        </div>
        ${has_connected
          ? html`
              ${view_state.step_index === 0
                ? renderStepSource(connected)
                : view_state.step_index === 1
                  ? renderStepStructure()
                  : view_state.step_index === 2
                    ? renderStepFilters()
                    : renderStepPreview()}
            `
          : html`
              <div class="import-dialog__empty">
                Нет подключённых интеграций. Подключите Yougile на странице
                Integrations.
              </div>
            `}
        <div class="import-dialog__actions">
          <button
            type="button"
            class="btn"
            ?disabled=${view_state.step_index === 0}
            @click=${goBack}
          >
            Назад
          </button>
          ${view_state.step_index === 2
            ? html`
                <button type="button" class="btn" @click=${goSkip}>
                  Пропустить
                </button>
              `
            : null}
          ${view_state.step_index < steps.length - 1
            ? html`
                <button
                  type="button"
                  class="btn primary"
                  ?disabled=${view_state.loading}
                  @click=${goNext}
                >
                  Далее
                </button>
              `
            : html`
                <button
                  type="button"
                  class="btn primary"
                  ?disabled=${view_state.loading ||
                  view_state.preview_tasks.length === 0}
                  @click=${runSelectedImport}
                >
                  ${view_state.loading ? 'Импорт...' : 'Импортировать'}
                </button>
              `}
        </div>
        ${view_state.preview_task
          ? renderPreviewModal(view_state.preview_task)
          : null}
      </div>
    `;
  }

  /**
   * @param {IntegrationOption[]} connected
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function renderStepSource(connected) {
    const has_teams = view_state.teams.length > 0;
    const supports_quick_link =
      view_state.selected_integration === 'yougile' ||
      (view_state.selected_integration === '' &&
        connected.length === 1 &&
        connected[0].id === 'yougile');
    return html`
      <div class="import-dialog__field">
        <label>
          <span>Менеджер задач</span>
          <select
            @change=${onIntegrationChange}
            .value=${view_state.selected_integration}
          >
            <option value="">Выберите...</option>
            ${connected.map(
              (item) => html` <option value=${item.id}>${item.name}</option> `
            )}
          </select>
        </label>
      </div>
      ${has_teams
        ? html`
            <div class="import-dialog__field">
              <label>
                <span>Команда</span>
                <select
                  @change=${onTeamChange}
                  .value=${view_state.selected_team}
                  ?disabled=${!view_state.selected_integration}
                >
                  <option value="">Выберите...</option>
                  ${view_state.teams.map(
                    (item) => html`
                      <option value=${item.id}>${item.title}</option>
                    `
                  )}
                </select>
              </label>
            </div>
          `
        : html` <div class="import-dialog__hint"></div> `}
      <div class="import-dialog__field">
        <label>
          <span>Проект</span>
          <select
            @change=${onProjectChange}
            .value=${view_state.selected_project}
            ?disabled=${!view_state.selected_integration ||
            (has_teams && !view_state.selected_team)}
          >
            <option value="">Выберите...</option>
            ${view_state.projects.map(
              (item) => html` <option value=${item.id}>${item.title}</option> `
            )}
          </select>
        </label>
      </div>
      ${supports_quick_link
        ? html`
            <div class="import-dialog__quick">
              <div class="import-dialog__quick-header">
                <span>Быстрый импорт по ссылке</span>
                <span class="import-dialog__hint-inline">
                  Вставьте ссылку вида
                  <span class="mono"
                    >https://ru.yougile.com/team/.../#DOC-519</span
                  >
                </span>
              </div>
              <div class="import-dialog__quick-controls">
                <input
                  type="text"
                  class="import-dialog__quick-input"
                  .value=${view_state.quick_task_input}
                  placeholder="https://ru.yougile.com/team/.../#DOC-519"
                  @input=${onQuickTaskInputChange}
                  @keydown=${onQuickTaskInputKeydown}
                  ?disabled=${view_state.quick_import_loading}
                />
                <button
                  type="button"
                  class="btn primary"
                  ?disabled=${view_state.quick_import_loading}
                  @click=${runQuickTaskImport}
                >
                  ${view_state.quick_import_loading
                    ? 'Импорт...'
                    : 'Импортировать по ссылке'}
                </button>
              </div>
            </div>
          `
        : null}
    `;
  }

  /**
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function renderStepStructure() {
    return html`
      <div class="import-dialog__field">
        <span>Колонки (опционально)</span>
        <div class="import-dialog__hint">
          Если не выбрать колонки, импортируются все колонки вкладки/проекта.
        </div>
        <div class="import-dialog__columns">
          ${view_state.columns.length === 0
            ? html`
                <div class="import-dialog__empty">
                  ${view_state.selected_project
                    ? 'Нет колонок'
                    : 'Выберите проект'}
                </div>
              `
            : view_state.columns.map((column) => {
                const label = column.board_title
                  ? `${column.board_title} · ${column.title}`
                  : column.title;
                const checked = view_state.selected_columns.has(column.id);
                return html`
                  <label class="import-dialog__column">
                    <input
                      type="checkbox"
                      ?checked=${checked}
                      @change=${() => toggleColumn(column.id)}
                    />
                    <span>${label}</span>
                  </label>
                `;
              })}
        </div>
      </div>
    `;
  }

  /**
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function renderStepFilters() {
    return html`
      <div class="import-dialog__field">
        <span>Исполнители</span>
        <div class="import-dialog__columns">
          ${view_state.users.length === 0
            ? html`
                <div class="import-dialog__empty">
                  ${view_state.selected_project
                    ? 'Нет исполнителей'
                    : 'Выберите проект'}
                </div>
              `
            : view_state.users.map((user) => {
                const checked = view_state.selected_users.has(user.id);
                return html`
                  <label class="import-dialog__column">
                    <input
                      type="checkbox"
                      ?checked=${checked}
                      @change=${() => toggleUser(user.id)}
                    />
                    <span>${user.name}</span>
                  </label>
                `;
              })}
        </div>
      </div>
      <div class="import-dialog__field">
        <span>Стикеры (включая severity)</span>
        <div class="import-dialog__columns">
          ${view_state.stickers.length === 0
            ? html`
                <div class="import-dialog__empty">
                  ${view_state.selected_project
                    ? 'Нет стикеров'
                    : 'Выберите проект'}
                </div>
              `
            : view_state.stickers.map(
                (sticker) => html`
                  <div class="import-dialog__sticker-group">
                    <div class="import-dialog__sticker-title">
                      ${sticker.title || 'Стикер'}
                    </div>
                    ${sticker.values.length === 0
                      ? html`
                          <div class="import-dialog__empty">Нет значений</div>
                        `
                      : sticker.values.map((value) => {
                          const checked =
                            view_state.selected_sticker_values.has(value.id);
                          return html`
                            <button
                              type="button"
                              class=${`import-dialog__tag ${
                                checked ? 'active' : ''
                              }`}
                              aria-pressed=${checked ? 'true' : 'false'}
                              @click=${() => toggleStickerValue(value.id)}
                            >
                              ${value.title || 'Состояние'}
                            </button>
                          `;
                        })}
                  </div>
                `
              )}
        </div>
      </div>
    `;
  }

  /**
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function renderStepPreview() {
    const effective_columns = getEffectiveColumnIds();
    const column_label_by_id = new Map(
      view_state.columns.map((column) => [
        column.id,
        column.board_title
          ? `${column.board_title} · ${column.title}`
          : column.title
      ])
    );
    return html`
      <div class="import-dialog__preview">
        ${view_state.preview_loading
          ? html`<div class="import-dialog__empty">Загрузка превью…</div>`
          : effective_columns.length === 0
            ? html`
                <div class="import-dialog__empty">
                  Нет колонок для превью. Выберите колонки или убедитесь, что в
                  проекте есть вкладки/колонки.
                </div>
              `
            : view_state.preview_tasks.length === 0
              ? html`
                  <div class="import-dialog__empty">Нет задач для импорта.</div>
                `
              : html`
                  <div class="import-dialog__preview-count">
                    Выбрано ${view_state.selected_task_ids.size} из
                    ${view_state.preview_tasks.length}
                    <span class="import-dialog__preview-actions">
                      <button
                        type="button"
                        class="import-dialog__tag"
                        @click=${selectAllTasks}
                      >
                        Выбрать все
                      </button>
                      <button
                        type="button"
                        class="import-dialog__tag"
                        @click=${clearSelectedTasks}
                      >
                        Очистить
                      </button>
                    </span>
                  </div>
                  <div class="import-dialog__preview-grid">
                    ${view_state.preview_tasks.map((task) => {
                      const column_label =
                        column_label_by_id.get(task.column_id) || 'Колонка';
                      const checked = view_state.selected_task_ids.has(task.id);
                      return html`
                        <button
                          type="button"
                          class="import-dialog__preview-card"
                          @click=${() => openPreview(task)}
                        >
                          <label class="import-dialog__preview-select">
                            <input
                              type="checkbox"
                              ?checked=${checked}
                              @click=${(/** @type {MouseEvent} */ ev) =>
                                ev.stopPropagation()}
                              @change=${() => toggleTaskSelection(task.id)}
                            />
                            <span>Импортировать</span>
                          </label>
                          <div class="import-dialog__preview-title">
                            ${task.title || 'Без названия'}
                          </div>
                          <div class="import-dialog__preview-meta">
                            <span>${column_label}</span>
                            <span class="mono">${task.id}</span>
                          </div>
                        </button>
                      `;
                    })}
                  </div>
                `}
      </div>
    `;
  }

  /**
   * @param {PreviewTask} task_info
   * @returns {void}
   */
  function openPreview(task_info) {
    setState({ preview_task: task_info });
  }

  /**
   * @returns {void}
   */
  function closePreview() {
    setState({ preview_task: null });
  }

  /**
   * @param {string} column_id
   * @returns {string}
   */
  function getColumnLabel(column_id) {
    const column = view_state.columns.find((item) => item.id === column_id);
    if (!column) {
      return 'Колонка';
    }
    if (column.board_title) {
      return `${column.board_title} · ${column.title}`;
    }
    return column.title || 'Колонка';
  }

  /**
   * @param {string} description_text
   * @param {string} link_url
   * @returns {string}
   */
  function buildPreviewBody(description_text, link_url) {
    /** @type {string[]} */
    const parts = [];
    if (description_text) {
      parts.push(description_text.trim());
    }
    if (link_url) {
      parts.push(link_url.trim());
    }
    return parts.filter((part) => part.length > 0).join('\n\n');
  }

  /**
   * @param {PreviewTask} task_info
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function renderPreviewModal(task_info) {
    const column_label = getColumnLabel(task_info.column_id);
    const body_text =
      task_info.body || buildPreviewBody(task_info.description, task_info.link);
    const has_body = body_text.length > 0;
    const has_link = task_info.link.length > 0;
    return html`
      <div class="import-dialog__preview-overlay" @click=${closePreview}>
        <div
          class="import-dialog__preview-modal"
          @click=${(/** @type {MouseEvent} */ ev) => ev.stopPropagation()}
        >
          <header class="import-dialog__preview-modal-header">
            <div>
              <div class="import-dialog__preview-modal-kicker">
                Превью задачи
              </div>
              <h4>${task_info.title || 'Без названия'}</h4>
            </div>
            <button
              type="button"
              class="import-dialog__preview-modal-close"
              aria-label="Close"
              @click=${closePreview}
            >
              ×
            </button>
          </header>
          <div class="import-dialog__preview-modal-meta">
            <span>${column_label}</span>
            <span class="mono">${task_info.id}</span>
          </div>
          ${has_body
            ? html`
                <div class="import-dialog__preview-body">${body_text}</div>
              `
            : html`
                <div class="import-dialog__empty">
                  Нет описания для предпросмотра.
                </div>
              `}
          ${has_link
            ? html`
                <a
                  class="import-dialog__preview-link"
                  href=${task_info.link}
                  target="_blank"
                  rel="noopener"
                >
                  Открыть в Yougile
                </a>
              `
            : null}
        </div>
      </div>
    `;
  }

  /**
   * @param {unknown} data
   * @returns {string}
   */
  function extractErrorMessage(data) {
    if (!data || typeof data !== 'object') {
      return '';
    }
    const any = /** @type {{ error?: any }} */ (data);
    if (typeof any.error === 'string') {
      return any.error;
    }
    if (any.error && typeof any.error === 'object') {
      if (typeof any.error.message === 'string') {
        return any.error.message;
      }
    }
    return '';
  }

  /**
   * @param {string[]} column_ids
   * @param {string[]} assignee_ids
   * @param {string[]} sticker_value_ids
   * @returns {string}
   */
  function buildPreviewKey(column_ids, assignee_ids, sticker_value_ids) {
    const columns = [...column_ids].sort().join(',');
    const assignees = [...assignee_ids].sort().join(',');
    const stickers = [...sticker_value_ids].sort().join(',');
    return `${columns}|${assignees}|${stickers}`;
  }

  /**
   * @returns {string[]}
   */
  function getEffectiveColumnIds() {
    const selected = Array.from(view_state.selected_columns);
    if (selected.length > 0) {
      return selected;
    }
    return view_state.columns.map((column) => column.id).filter(Boolean);
  }

  return {
    open,
    destroy() {
      try {
        dialog.remove();
      } catch {
        // ignore
      }
    }
  };
}
