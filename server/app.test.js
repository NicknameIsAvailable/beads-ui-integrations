import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createApp, isExternalRefDuplicateError } from './app.js';
import { getConfig } from './config.js';

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
