import { html, render } from 'lit-html';
import { listIntegrations } from '../data/integration-registry.js';
import {
  connectYougile,
  fetchIntegrationsStatus
} from '../data/integrations.js';
import { debug } from '../utils/logging.js';
import { showToast } from '../utils/toast.js';

/**
 * @param {HTMLElement} mount_element
 */
export function createIntegrationsView(mount_element) {
  const log = debug('views:integrations');
  const definitions = listIntegrations();
  /** @type {{ loading: boolean, dialog_open: boolean, auth_mode: 'credentials'|'api_key', base_url: string, selected_id: string | null, detail_id: string | null, status_by_id: Record<string, { connected: boolean, base_url: string }> }} */
  let view_state = {
    loading: true,
    dialog_open: false,
    auth_mode: 'credentials',
    base_url: 'https://yougile.com',
    selected_id: null,
    detail_id: null,
    status_by_id: {}
  };

  const dialog = /** @type {HTMLDialogElement} */ (
    document.createElement('dialog')
  );
  dialog.id = 'yougile-connect-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.appendChild(dialog);

  dialog.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('mousedown', (ev) => {
    if (ev.target === dialog) {
      closeDialog();
    }
  });

  /**
   * @returns {string | null}
   */
  function getDetailIdFromHash() {
    const hash_value = String(window.location.hash || '');
    const hash_match = /^#\/integrations\/([^/?#]+)/.exec(hash_value);
    if (!hash_match || !hash_match[1]) {
      return null;
    }
    const raw_id = decodeURIComponent(hash_match[1]);
    const found_definition = definitions.find((item) => item.id === raw_id);
    return found_definition ? found_definition.id : null;
  }

  /**
   * @returns {void}
   */
  function syncDetailFromHash() {
    const detail_id = getDetailIdFromHash();
    if (detail_id === view_state.detail_id) {
      return;
    }
    setState({ detail_id });
  }

  window.addEventListener('hashchange', syncDetailFromHash);
  syncDetailFromHash();

  /**
   * @param {Partial<typeof view_state>} patch
   */
  function setState(patch) {
    view_state = { ...view_state, ...patch };
    doRender();
  }

  /**
   * @param {{ id: string, name: string, base_url_default: string, auth_modes: Array<'credentials'|'api_key'> }} definition
   */
  function openDialogFor(definition) {
    const status = view_state.status_by_id[definition.id];
    const base_url =
      status && status.base_url ? status.base_url : definition.base_url_default;
    const next_mode = definition.auth_modes.includes('credentials')
      ? 'credentials'
      : 'api_key';
    setState({
      dialog_open: true,
      selected_id: definition.id,
      base_url,
      auth_mode: next_mode
    });
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /**
   * @returns {void}
   */
  function closeDialog() {
    setState({ dialog_open: false, loading: false, selected_id: null });
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async function loadStatus() {
    setState({ loading: true });
    try {
      const result = await fetchIntegrationsStatus();
      if (result.ok && result.data && typeof result.data === 'object') {
        const data = /** @type {any} */ (result.data);
        /** @type {Record<string, { connected: boolean, base_url: string }>} */
        const status_by_id = {};
        const statuses = Array.isArray(data.statuses) ? data.statuses : [];
        for (const status of statuses) {
          if (!status || typeof status !== 'object') {
            continue;
          }
          const id = String(/** @type {any} */ (status).id || '');
          if (!id) {
            continue;
          }
          status_by_id[id] = {
            connected: Boolean(/** @type {any} */ (status).connected),
            base_url: String(/** @type {any} */ (status).base_url || '')
          };
        }
        setState({ loading: false, status_by_id });
        return;
      }
      setState({ loading: false, status_by_id: {} });
    } catch (err) {
      log('load status failed: %o', err);
      setState({ loading: false, status_by_id: {} });
    }
  }

  /**
   * @param {SubmitEvent} ev
   */
  async function handleSubmit(ev) {
    ev.preventDefault();
    const form = /** @type {HTMLFormElement} */ (ev.currentTarget);
    const form_data = new FormData(form);
    const login = String(form_data.get('login') || '');
    const password = String(form_data.get('password') || '');
    const company_id = String(form_data.get('company_id') || '');
    const api_key = String(form_data.get('api_key') || '');
    const base_url = String(form_data.get('base_url') || 'https://yougile.com');

    if (!view_state.selected_id) {
      showToast('Выберите интеграцию', 'error', 2400);
      return;
    }

    if (view_state.auth_mode === 'credentials') {
      if (!login || !password || !company_id) {
        showToast('Введите логин, пароль и companyId', 'error', 3000);
        return;
      }
    } else if (!api_key) {
      showToast('Введите API ключ', 'error', 3000);
      return;
    }

    setState({ loading: true });
    try {
      const payload =
        view_state.auth_mode === 'credentials'
          ? { base_url, login, password, company_id }
          : { base_url, api_key };
      const result =
        view_state.selected_id === 'yougile'
          ? await connectYougile(payload)
          : {
              ok: false,
              status: 400,
              data: { error: 'Unsupported integration' }
            };
      if (result.ok) {
        showToast('Yougile подключён', 'success', 2400);
        form.reset();
        setState({
          loading: false,
          base_url,
          dialog_open: false
        });
        closeDialog();
        void loadStatus();
        return;
      }
      setState({ loading: false });
      const error_message = extractErrorMessage(result.data);
      showToast(
        error_message || 'Не удалось подключить Yougile',
        'error',
        3600
      );
    } catch (err) {
      log('connect failed: %o', err);
      setState({ loading: false });
      showToast('Ошибка подключения Yougile', 'error', 3000);
    }
  }

  /**
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function template() {
    const detail_definition = view_state.detail_id
      ? definitions.find((item) => item.id === view_state.detail_id)
      : null;
    return html`
      <section class="integrations-root">
        ${detail_definition
          ? renderDetail(detail_definition)
          : html`
              <header class="integrations-header">
                <h2>Integrations</h2>
                <p class="integrations-subtitle">
                  Подключите таск-менеджеры и импортируйте задачи.
                </p>
              </header>

              <div class="integrations-grid">
                ${definitions.map((definition) => {
                  const status = view_state.status_by_id[definition.id];
                  const connected = Boolean(status && status.connected);
                  return html`
                    <article
                      class="integration-card"
                      @click=${() => openDetail(definition.id)}
                    >
                      <div class="integration-card__header">
                        <div class="integration-logo">
                          ${logoFor(definition.id)}
                        </div>
                        <div>
                          <h3>${definition.name}</h3>
                          <div class="integration-status">
                            ${view_state.loading
                              ? 'Проверка...'
                              : connected
                                ? 'Подключено'
                                : 'Не подключено'}
                          </div>
                        </div>
                      </div>
                      <p class="integration-card__body">
                        ${definition.description}
                      </p>
                      <div class="integration-card__actions">
                        <button
                          type="button"
                          class="btn primary"
                        @click=${(/** @type {MouseEvent} */ ev) => {
                          ev.stopPropagation();
                          openDialogFor(definition);
                        }}
                        >
                          Подключить
                        </button>
                      </div>
                    </article>
                  `;
                })}
              </div>
            `}
      </section>
    `;
  }

  /**
   * @param {string} integration_id
   * @returns {void}
   */
  function openDetail(integration_id) {
    const next_hash = `#/integrations/${encodeURIComponent(integration_id)}`;
    if (window.location.hash !== next_hash) {
      window.location.hash = next_hash;
      return;
    }
    setState({ detail_id: integration_id });
  }

  /**
   * @returns {void}
   */
  function closeDetail() {
    const next_hash = '#/integrations';
    if (window.location.hash !== next_hash) {
      window.location.hash = next_hash;
      return;
    }
    setState({ detail_id: null });
  }

  /**
   * @param {{ id: string, name: string, description: string, docs_url: string, api_key_steps: string[], api_key_request: { method: string, url: string, body: string }, base_url_default: string, auth_modes: Array<'credentials'|'api_key'> }} definition
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function renderDetail(definition) {
    const status_info = view_state.status_by_id[definition.id];
    const connected = Boolean(status_info && status_info.connected);
    const request_data = definition.api_key_request;
    return html`
      <header class="integrations-detail__header">
        <button type="button" class="btn" @click=${closeDetail}>← Назад</button>
        <div class="integrations-detail__title">
          <div class="integration-logo">${logoFor(definition.id)}</div>
          <div>
            <h2>${definition.name}</h2>
            <div class="integration-status">
              ${view_state.loading
                ? 'Проверка...'
                : connected
                  ? 'Подключено'
                  : 'Не подключено'}
            </div>
          </div>
        </div>
        <button
          type="button"
          class="btn primary"
          @click=${() => openDialogFor(definition)}
        >
          ${connected ? 'Переподключить' : 'Подключить'}
        </button>
      </header>
      <div class="integrations-detail">
        <section class="integrations-detail__panel">
          <h3>Описание</h3>
          <p>${definition.description}</p>
        </section>
        <section class="integrations-detail__panel">
          <h3>Как получить API ключ</h3>
          <ul>
            ${definition.api_key_steps.map((step) => html`<li>${step}</li>`)}
          </ul>
          <div class="integrations-detail__code">
            <div class="integrations-detail__code-title">
              ${request_data.method} ${request_data.url}
            </div>
            <pre><code>${request_data.body}</code></pre>
          </div>
        </section>
        <section class="integrations-detail__panel">
          <h3>Документация API</h3>
          <a
            class="integrations-detail__link"
            href=${definition.docs_url}
            target="_blank"
            rel="noopener"
          >
            Открыть документацию
          </a>
        </section>
      </div>
    `;
  }

  /**
   * @returns {void}
   */
  function doRender() {
    render(template(), mount_element);
    render(dialogTemplate(), dialog);
  }

  /**
   * @returns {import('lit-html').TemplateResult<1>}
   */
  function dialogTemplate() {
    const selected = view_state.selected_id
      ? definitions.find((item) => item.id === view_state.selected_id)
      : null;
    const auth_modes = selected ? selected.auth_modes : [];
    return html`
      <div class="integration-dialog">
        <header class="integration-dialog__header">
          <h3>
            ${selected
              ? `Подключить ${selected.name}`
              : 'Подключить интеграцию'}
          </h3>
          <button
            type="button"
            class="integration-dialog__close"
            aria-label="Close"
            @click=${closeDialog}
          >
            ×
          </button>
        </header>
        <form class="integration-form" @submit=${handleSubmit}>
          <div class="integration-mode">
            ${auth_modes.includes('credentials')
              ? html`
                  <label>
                    <input
                      type="radio"
                      name="auth_mode"
                      value="credentials"
                      ?checked=${view_state.auth_mode === 'credentials'}
                      @change=${() => setState({ auth_mode: 'credentials' })}
                    />
                    Логин + пароль + companyId
                  </label>
                `
              : null}
            ${auth_modes.includes('api_key')
              ? html`
                  <label>
                    <input
                      type="radio"
                      name="auth_mode"
                      value="api_key"
                      ?checked=${view_state.auth_mode === 'api_key'}
                      @change=${() => setState({ auth_mode: 'api_key' })}
                    />
                    API ключ
                  </label>
                `
              : null}
          </div>
          <label>
            <span>Base URL</span>
            <input
              name="base_url"
              type="url"
              value="${view_state.base_url}"
              placeholder="https://yougile.com"
            />
          </label>
          ${view_state.auth_mode === 'credentials'
            ? html`
                <label>
                  <span>Логин</span>
                  <input name="login" type="email" autocomplete="username" />
                </label>
                <label>
                  <span>Пароль</span>
                  <input
                    name="password"
                    type="password"
                    autocomplete="current-password"
                  />
                </label>
                <label>
                  <span>Company ID</span>
                  <input name="company_id" type="text" />
                </label>
              `
            : html`
                <label>
                  <span>API ключ</span>
                  <input name="api_key" type="text" />
                </label>
              `}
          <div class="integration-dialog__actions">
            <button type="button" class="btn" @click=${closeDialog}>
              Отмена
            </button>
            <button
              type="submit"
              class="btn primary"
              ?disabled=${view_state.loading}
            >
              ${view_state.loading ? 'Подключаем...' : 'Подключить'}
            </button>
          </div>
        </form>
      </div>
    `;
  }

  /**
   * @param {string} integration_id
   * @returns {string}
   */
  function logoFor(integration_id) {
    if (integration_id === 'yougile') {
      return 'YG';
    }
    return integration_id.slice(0, 2).toUpperCase();
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
      const msg =
        typeof any.error.message === 'string' ? any.error.message : '';
      if (msg) {
        return msg;
      }
      const details =
        typeof any.error.details === 'string'
          ? any.error.details
          : any.error.details && typeof any.error.details.message === 'string'
            ? any.error.details.message
            : '';
      return details || '';
    }
    return '';
  }

  doRender();
  void loadStatus();

  return {
    reload() {
      void loadStatus();
    },
    destroy() {
      try {
        dialog.remove();
      } catch {
        // ignore
      }
      render(html``, mount_element);
    }
  };
}
