import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createApp, isExternalRefDuplicateError } from './app.js';
import { getConfig } from './config.js';
import { saveYougileConnection } from './integrations/store.js';

/**
 * Narrow to function type for basic checks.
 *
 * @param {unknown} value
 * @returns {value is Function}
 */
function isFunction(value) {
  return typeof value === 'function';
}

describe('server app wiring (no listen)', () => {
  test('createApp returns an express-like app', () => {
    const config = getConfig();
    const app = createApp(config);
    expect(isFunction(app.get)).toBe(true);
    expect(isFunction(app.use)).toBe(true);
  });

  test('index.html exists in configured app_dir', () => {
    const config = getConfig();
    const index_path = path.join(config.app_dir, 'index.html');
    expect(fs.existsSync(index_path)).toBe(true);
  });

  test('register-workspace endpoint notifies workspace updates callback', async () => {
    const config = getConfig();
    const onWorkspacesUpdated = vi.fn();
    const app = createApp(config, { onWorkspacesUpdated });
    const server = app.listen(0, '127.0.0.1');

    try {
      await once(server, 'listening');
      const address = /** @type {import('node:net').AddressInfo | null} */ (
        server.address()
      );
      if (!address || typeof address.port !== 'number') {
        throw new Error('Expected listening server address');
      }

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/register-workspace`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            path: '/tmp/workspace-a',
            database: '/tmp/workspace-a/.beads/bd.db'
          })
        }
      );

      expect(response.status).toBe(200);
      expect(onWorkspacesUpdated).toHaveBeenCalledWith('register-workspace');
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(undefined);
        });
      });
    }
  });

  test('integration endpoints resolve workspace from active workspace callback by default', async () => {
    const config = getConfig();
    const temp_root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdui-app-'));
    const default_root = path.join(temp_root, 'default');
    const active_root = path.join(temp_root, 'active');
    fs.mkdirSync(default_root, { recursive: true });
    fs.mkdirSync(active_root, { recursive: true });
    saveYougileConnection(active_root, {
      api_key: 'test-key',
      base_url: 'https://yougile.com'
    });

    const app = createApp(
      { ...config, root_dir: default_root },
      {
        resolveWorkspaceRoot: () => active_root
      }
    );
    const server = app.listen(0, '127.0.0.1');

    try {
      await once(server, 'listening');
      const address = /** @type {import('node:net').AddressInfo | null} */ (
        server.address()
      );
      if (!address || typeof address.port !== 'number') {
        throw new Error('Expected listening server address');
      }

      const response_without_header = await fetch(
        `http://127.0.0.1:${address.port}/api/integrations/yougile/status`
      );
      const data_without_header = /** @type {any} */ (
        await response_without_header.json()
      );
      expect(response_without_header.status).toBe(200);
      expect(data_without_header.connected).toBe(true);

      const response_with_invalid_header = await fetch(
        `http://127.0.0.1:${address.port}/api/integrations/yougile/status`,
        {
          headers: { 'x-beads-workspace': '/tmp/not-a-workspace' }
        }
      );
      const data_with_invalid_header = /** @type {any} */ (
        await response_with_invalid_header.json()
      );
      expect(response_with_invalid_header.status).toBe(200);
      expect(data_with_invalid_header.connected).toBe(true);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(undefined);
        });
      });
      fs.rmSync(temp_root, { recursive: true, force: true });
    }
  });
});

describe('isExternalRefDuplicateError', () => {
  test('detects sqlite unique errors for issues.external_ref', () => {
    const message =
      'Error: operation failed: sqlite3: constraint failed: UNIQUE constraint failed: issues.external_ref';

    const result = isExternalRefDuplicateError(message);

    expect(result).toBe(true);
  });

  test('returns false for unrelated errors', () => {
    const message = 'Error: operation failed: timeout waiting for response';

    const result = isExternalRefDuplicateError(message);

    expect(result).toBe(false);
  });
});
