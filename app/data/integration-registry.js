/**
 * @typedef {Object} IntegrationDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} docs_url
 * @property {string[]} api_key_steps
 * @property {{ method: string, url: string, body: string }} api_key_request
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
    docs_url: 'https://ru.yougile.com/api-v2#/',
    api_key_steps: [
      'Сформируйте запрос на получение ключа в Yougile.',
      'Передайте login, password и companyId в теле запроса.',
      'Используйте полученный ключ в интеграции.'
    ],
    api_key_request: {
      method: 'POST',
      url: 'https://yougile.com/api-v2/auth/keys',
      body:
        '{\n' +
        '  "login": "user@example.com",\n' +
        '  "password": "your-password",\n' +
        '  "companyId": "company-id"\n' +
        '}'
    },
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
