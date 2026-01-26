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
  const res = await fetch(url, options);
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
