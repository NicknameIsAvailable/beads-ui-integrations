/**
 * Yougile API v2 client utilities.
 */

/**
 * @typedef {Object} YougileRequestOptions
 * @property {string} path
 * @property {'GET'|'POST'|'PUT'|'DELETE'} [method]
 * @property {Record<string, string | number | boolean>} [query]
 * @property {unknown} [body]
 */

/**
 * @typedef {Object} YougileResponseOk
 * @property {true} ok
 * @property {number} status
 * @property {unknown} data
 */

/**
 * @typedef {Object} YougileResponseError
 * @property {false} ok
 * @property {number} status
 * @property {{ code: string, message: string, details?: Record<string, unknown> }} error
 */

/**
 * @typedef {Object} YougileClient
 * @property {(options: YougileRequestOptions) => Promise<YougileResponseOk | YougileResponseError>} request
 */

/**
 * Normalize base URL so that it always ends with "/api-v2".
 *
 * @param {string} base_url
 * @returns {string}
 */
export function normalizeYougileBaseUrl(base_url) {
  if (typeof base_url !== 'string' || base_url.trim().length === 0) {
    throw new Error('Yougile base_url must be a non-empty string.');
  }
  let normalized = base_url.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  if (!normalized.endsWith('/api-v2')) {
    normalized = `${normalized}/api-v2`;
  }
  return normalized;
}

/**
 * Request a Yougile API key using login/password/companyId.
 * This endpoint is unauthenticated and must not include a Bearer token.
 *
 * @param {{ base_url: string, login: string, password: string, company_id: string, fetch_fn?: typeof fetch }} options
 * @returns {Promise<YougileResponseOk | YougileResponseError>}
 */
export async function requestYougileApiKey(options) {
  const base_url = normalizeYougileBaseUrl(options.base_url);
  const login = options.login;
  const password = options.password;
  const company_id = options.company_id;
  if (typeof login !== 'string' || login.trim().length === 0) {
    throw new Error('Yougile login must be a non-empty string.');
  }
  if (typeof password !== 'string' || password.trim().length === 0) {
    throw new Error('Yougile password must be a non-empty string.');
  }
  if (typeof company_id !== 'string' || company_id.trim().length === 0) {
    throw new Error('Yougile company_id must be a non-empty string.');
  }
  const fetch_fn = options.fetch_fn || fetch;

  const url = buildYougileUrl(base_url, '/auth/keys', undefined);
  const res = await fetch_fn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login,
      password,
      companyId: company_id
    })
  });

  const content_type =
    res.headers && res.headers.get ? res.headers.get('content-type') || '' : '';
  let data = null;
  if (content_type.includes('application/json')) {
    try {
      data = await res.json();
    } catch (err) {
      data = { error: 'invalid_json', message: String(err) };
    }
  } else {
    try {
      data = await res.text();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: {
        code: 'yougile_http_error',
        message: `Yougile request failed with status ${res.status}`,
        details: data && typeof data === 'object' ? data : { body: data }
      }
    };
  }

  return { ok: true, status: res.status, data };
}

/**
 * Create a Yougile API client.
 *
 * @param {{ base_url: string, api_key: string, fetch_fn?: typeof fetch }} options
 * @returns {YougileClient}
 */
export function createYougileClient(options) {
  const base_url = normalizeYougileBaseUrl(options.base_url);
  const api_key = options.api_key;
  if (typeof api_key !== 'string' || api_key.trim().length === 0) {
    throw new Error('Yougile api_key must be a non-empty string.');
  }
  const fetch_fn = options.fetch_fn || fetch;

  return {
    /**
     * @param {YougileRequestOptions} req_options
     */
    async request(req_options) {
      const path = String(req_options.path || '');
      if (path.length === 0) {
        return {
          ok: false,
          status: 0,
          error: {
            code: 'invalid_path',
            message: 'Yougile request path is required.'
          }
        };
      }

      const url = buildYougileUrl(base_url, path, req_options.query);
      const method = req_options.method ? req_options.method : 'GET';

      /** @type {Record<string, string>} */
      const headers = {
        Authorization: `Bearer ${api_key}`
      };

      /** @type {string | undefined} */
      let body_text;
      if (req_options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body_text = JSON.stringify(req_options.body);
      }

      const res = await fetch_fn(url, {
        method,
        headers,
        body: body_text
      });

      const content_type =
        res.headers && res.headers.get
          ? res.headers.get('content-type') || ''
          : '';

      let data = null;
      if (content_type.includes('application/json')) {
        try {
          data = await res.json();
        } catch (err) {
          data = { error: 'invalid_json', message: String(err) };
        }
      } else {
        try {
          data = await res.text();
        } catch {
          data = null;
        }
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: {
            code: 'yougile_http_error',
            message: `Yougile request failed with status ${res.status}`,
            details: data && typeof data === 'object' ? data : { body: data }
          }
        };
      }

      return { ok: true, status: res.status, data };
    }
  };
}

/**
 * Fetch list data from Yougile using candidate paths and normalize the payload.
 *
 * @param {YougileClient} client
 * @param {string[]} paths
 * @param {Record<string, string | number | boolean>} [query]
 * @returns {Promise<YougileResponseOk | YougileResponseError>}
 */
export async function fetchYougileList(client, paths, query = undefined) {
  /** @type {YougileResponseError | null} */
  let last_error = null;
  for (const path of paths) {
    const res = await client.request({ path, query });
    if (res.ok) {
      return res;
    }
    last_error = res;
    if (res.status !== 404) {
      return res;
    }
  }
  return (
    last_error || {
      ok: false,
      status: 404,
      error: { code: 'yougile_not_found', message: 'Resource not found' }
    }
  );
}

/**
 * Normalize list payloads from Yougile API.
 *
 * @param {unknown} data
 * @returns {unknown[]}
 */
export function normalizeYougileList(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== 'object') {
    return [];
  }
  const any =
    /** @type {{ content?: unknown, Content?: unknown, items?: unknown }} */ (
      data
    );
  if (Array.isArray(any.content)) {
    return any.content;
  }
  if (Array.isArray(any.Content)) {
    return any.Content;
  }
  if (Array.isArray(any.items)) {
    return any.items;
  }
  return [];
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeYougileId(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeYougileTitle(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {string} base_url
 * @param {string} path
 * @param {Record<string, string | number | boolean> | undefined} query
 * @returns {string}
 */
function buildYougileUrl(base_url, path, query) {
  const normalized_path = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(normalized_path, `${base_url}/`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
