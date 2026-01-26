import { describe, expect, test } from 'vitest';
import {
  createYougileClient,
  normalizeYougileBaseUrl,
  requestYougileApiKey
} from './yougile.js';

describe('yougile client', () => {
  test('normalizes base url to api-v2', () => {
    const value = normalizeYougileBaseUrl('https://example.com');

    expect(value).toBe('https://example.com/api-v2');
  });

  test('preserves api-v2 when already present', () => {
    const value = normalizeYougileBaseUrl('https://example.com/api-v2/');

    expect(value).toBe('https://example.com/api-v2');
  });

  test('sends authorization header and query params', async () => {
    /** @type {Array<{ url: string, options: any }>} */
    const calls = [];
    const fetch_fn = /** @type {any} */ (async (
      /** @type {any} */ url,
      /** @type {any} */ options
    ) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: {
          get() {
            return 'application/json';
          }
        },
        async json() {
          return { ok: true };
        }
      };
    });

    const client = createYougileClient({
      base_url: 'https://example.com',
      api_key: 'token-123',
      fetch_fn
    });

    const result = await client.request({
      path: '/projects',
      query: { page: 2 }
    });

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://example.com/api-v2/projects?page=2');
    expect(calls[0].options.headers.Authorization).toBe('Bearer token-123');
  });

  test('returns structured error for non-ok responses', async () => {
    const fetch_fn = /** @type {any} */ (async () => {
      return {
        ok: false,
        status: 403,
        headers: {
          get() {
            return 'application/json';
          }
        },
        async json() {
          return { message: 'forbidden' };
        }
      };
    });

    const client = createYougileClient({
      base_url: 'https://example.com',
      api_key: 'token-123',
      fetch_fn
    });

    const result = await client.request({ path: '/projects' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error.code).toBe('yougile_http_error');
    }
  });

  test('auth key request posts login/password/companyId', async () => {
    /** @type {Array<{ url: string, options: any }>} */
    const calls = [];
    const fetch_fn = /** @type {any} */ (async (
      /** @type {any} */ url,
      /** @type {any} */ options
    ) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: {
          get() {
            return 'application/json';
          }
        },
        async json() {
          return { key: 'api-key' };
        }
      };
    });

    const result = await requestYougileApiKey({
      base_url: 'https://yougile.com',
      login: 'user@example.com',
      password: 'secret',
      company_id: 'company-123',
      fetch_fn
    });

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://yougile.com/api-v2/auth/keys');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].options.body)).toEqual({
      login: 'user@example.com',
      password: 'secret',
      companyId: 'company-123'
    });
  });
});
