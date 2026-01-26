/**
 * @typedef {Object} IntegrationDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} base_url_default
 * @property {Array<'credentials'|'api_key'>} auth_modes
 */

/** @type {IntegrationDefinition[]} */
export const INTEGRATION_REGISTRY = [
  {
    id: 'yougile',
    name: 'Yougile',
    description:
      'Подключение через login/password/companyId или напрямую через API ключ.',
    base_url_default: 'https://yougile.com',
    auth_modes: ['credentials', 'api_key']
  }
];

/**
 * @returns {IntegrationDefinition[]}
 */
export function listIntegrations() {
  return INTEGRATION_REGISTRY.slice();
}
