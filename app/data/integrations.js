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
export async function fetchYougileStatus() {
  return requestJson('/api/integrations/yougile/status');
}

/**
 * @returns {Promise<ApiResult>}
 */
export async function fetchIntegrationsStatus() {
  return requestJson('/api/integrations/status');
}

/**
 * @param {{ base_url: string, login?: string, password?: string, company_id?: string, api_key?: string }} payload
 * @returns {Promise<ApiResult>}
 */
export async function connectYougile(payload) {
  return requestJson('/api/integrations/yougile/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/**
 * @returns {Promise<ApiResult>}
 */
export async function disconnectYougile() {
  return requestJson('/api/integrations/yougile/connect', {
    method: 'DELETE'
  });
}

/**
 * @returns {Promise<ApiResult>}
 */
export async function pingYougile() {
  return requestJson('/api/integrations/yougile/ping');
}
