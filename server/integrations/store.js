import fs from 'node:fs';
import path from 'node:path';
import { listIntegrations } from './registry.js';

/**
 * @typedef {Object} YougileConnection
 * @property {string} api_key
 * @property {string} base_url
 * @property {string | null} [company_id]
 * @property {number} connected_at
 */

/**
 * @typedef {Object} IntegrationsState
 * @property {YougileConnection | null} [yougile]
 */

/**
 * @param {string} root_dir
 * @returns {string}
 */
export function getIntegrationsPath(root_dir) {
  return path.join(root_dir, '.beads', 'integrations.json');
}

/**
 * @param {string} root_dir
 * @returns {IntegrationsState}
 */
export function readIntegrations(root_dir) {
  const file_path = getIntegrationsPath(root_dir);
  try {
    const raw = fs.readFileSync(file_path, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return {};
    }
    return /** @type {IntegrationsState} */ (data);
  } catch {
    return {};
  }
}

/**
 * @param {string} root_dir
 * @param {IntegrationsState} data
 */
export function writeIntegrations(root_dir, data) {
  const file_path = getIntegrationsPath(root_dir);
  const dir_path = path.dirname(file_path);
  fs.mkdirSync(dir_path, { recursive: true });
  fs.writeFileSync(file_path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * @param {string} root_dir
 * @param {{ api_key: string, base_url: string, company_id?: string | null }} payload
 * @returns {YougileConnection}
 */
export function saveYougileConnection(root_dir, payload) {
  const state = readIntegrations(root_dir);
  const now = Date.now();
  const next = {
    api_key: payload.api_key,
    base_url: payload.base_url,
    company_id: payload.company_id || state.yougile?.company_id || null,
    connected_at: now
  };
  const updated = { ...state, yougile: next };
  writeIntegrations(root_dir, updated);
  return next;
}

/**
 * @param {string} root_dir
 */
export function clearYougileConnection(root_dir) {
  const state = readIntegrations(root_dir);
  const updated = { ...state, yougile: null };
  writeIntegrations(root_dir, updated);
}

/**
 * @param {string} root_dir
 * @returns {Array<{ id: string, connected: boolean, base_url: string }>}
 */
export function getIntegrationStatusList(root_dir) {
  const definitions = listIntegrations();
  const state = readIntegrations(root_dir);
  /** @type {Array<{ id: string, connected: boolean, base_url: string }>} */
  const items = [];
  for (const definition of definitions) {
    if (definition.id === 'yougile') {
      const yougile = state.yougile || null;
      items.push({
        id: definition.id,
        connected: Boolean(yougile && yougile.api_key),
        base_url: yougile?.base_url || definition.base_url_default
      });
      continue;
    }
    items.push({
      id: definition.id,
      connected: false,
      base_url: definition.base_url_default
    });
  }
  return items;
}
