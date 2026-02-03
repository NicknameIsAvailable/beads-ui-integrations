/**
 * @typedef {Object} ApiResult
 * @property {boolean} ok
 * @property {number} status
 * @property {unknown} data
 */

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<ApiResult>}
 */
async function requestJson(url, options = {}) {
  const workspace_headers = getWorkspaceHeaders();
  const merged_headers = {
    ...workspace_headers,
    ...(options.headers
      ? /** @type {Record<string, string>} */ (options.headers)
      : {})
  };
  const res = await fetch(url, {
    ...options,
    headers: merged_headers
  });
  const status = res.status;
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status, data };
}

/**
 * @returns {Record<string, string>}
 */
function getWorkspaceHeaders() {
  const stored_path = window.localStorage.getItem('beads-ui.workspace');
  if (!stored_path) {
    return {};
  }
  return { 'x-beads-workspace': stored_path };
}

/**
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationsStatus() {
  return requestJson('/api/integrations/status');
}

/**
 * @param {string} integration_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationTeams(integration_id) {
  return requestJson(`/api/integrations/${integration_id}/teams`);
}

/**
 * @param {string} integration_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationProjects(integration_id) {
  return requestJson(`/api/integrations/${integration_id}/projects`);
}

/**
 * @param {string} integration_id
 * @param {string} team_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationProjectsForTeam(integration_id, team_id) {
  const url = new URL(
    `/api/integrations/${integration_id}/projects`,
    window.location.origin
  );
  if (team_id) {
    url.searchParams.set('team_id', team_id);
  }
  return requestJson(url.toString());
}

/**
 * @param {string} integration_id
 * @param {string} project_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationBoards(integration_id, project_id) {
  const url = new URL(
    `/api/integrations/${integration_id}/boards`,
    window.location.origin
  );
  url.searchParams.set('project_id', project_id);
  return requestJson(url.toString());
}

/**
 * @param {string} integration_id
 * @param {{ board_id?: string, task_id: string }} payload
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationTaskSearch(integration_id, payload) {
  const url = new URL(
    `/api/integrations/${integration_id}/task-search`,
    window.location.origin
  );
  if (payload.board_id) {
    url.searchParams.set('board_id', payload.board_id);
  }
  url.searchParams.set('task_id', payload.task_id);
  return requestJson(url.toString());
}

/**
 * @param {string} integration_id
 * @param {{ task_id: string, column_id: string }} payload
 * @returns {Promise<ApiResult>}
 */
export async function moveIntegrationTask(integration_id, payload) {
  return requestJson(`/api/integrations/${integration_id}/move-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/**
 * @param {string} integration_id
 * @param {string} project_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationColumns(integration_id, project_id) {
  const url = new URL(
    `/api/integrations/${integration_id}/columns`,
    window.location.origin
  );
  url.searchParams.set('project_id', project_id);
  return requestJson(url.toString());
}

/**
 * @param {string} integration_id
 * @param {string} board_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationColumnsForBoard(
  integration_id,
  board_id
) {
  const url = new URL(
    `/api/integrations/${integration_id}/columns`,
    window.location.origin
  );
  url.searchParams.set('board_id', board_id);
  return requestJson(url.toString());
}

/**
 * @param {string} integration_id
 * @param {string} project_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationUsers(integration_id, project_id) {
  const url = new URL(
    `/api/integrations/${integration_id}/users`,
    window.location.origin
  );
  url.searchParams.set('project_id', project_id);
  return requestJson(url.toString());
}

/**
 * @param {string} integration_id
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationStickers(integration_id) {
  return requestJson(`/api/integrations/${integration_id}/stickers`);
}

/**
 * @param {string} integration_id
 * @param {{ column_ids: string[], assignee_ids?: string[], sticker_value_ids?: string[] }} payload
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationPreview(integration_id, payload) {
  const url = new URL(
    `/api/integrations/${integration_id}/preview`,
    window.location.origin
  );
  if (Array.isArray(payload.column_ids) && payload.column_ids.length > 0) {
    url.searchParams.set('column_ids', payload.column_ids.join(','));
  }
  if (Array.isArray(payload.assignee_ids) && payload.assignee_ids.length > 0) {
    url.searchParams.set('assignee_ids', payload.assignee_ids.join(','));
  }
  if (
    Array.isArray(payload.sticker_value_ids) &&
    payload.sticker_value_ids.length > 0
  ) {
    url.searchParams.set(
      'sticker_value_ids',
      payload.sticker_value_ids.join(',')
    );
  }
  return requestJson(url.toString());
}

/**
 * @param {string} integration_id
 * @param {{ project_id: string, team_id?: string, column_ids: string[], assignee_ids?: string[], sticker_value_ids?: string[], task_ids?: string[] }} payload
 * @returns {Promise<ApiResult>}
 */
export async function runImport(integration_id, payload) {
  return requestJson(`/api/integrations/${integration_id}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
