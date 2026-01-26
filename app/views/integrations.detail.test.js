import { describe, expect, test, vi } from 'vitest';
import { createIntegrationsView } from './integrations.js';

vi.mock('../data/integrations.js', () => ({
  fetchIntegrationsStatus: vi.fn(async () => ({
    ok: true,
    data: {
      statuses: [
        { id: 'yougile', connected: false, base_url: 'https://yougile.com' }
      ]
    }
  })),
  connectYougile: vi.fn(async () => ({ ok: true, data: {} }))
}));

describe('views/integrations detail', () => {
  test('renders detail page from hash', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount_element = /** @type {HTMLElement} */ (
      document.getElementById('m')
    );
    window.location.hash = '#/integrations/yougile';

    createIntegrationsView(mount_element);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const detail_header = mount_element.querySelector(
      '.integrations-detail__header'
    );
    expect(detail_header).not.toBeNull();
    expect(mount_element.textContent).toContain('Yougile');
    expect(
      mount_element.querySelector('.integrations-detail__link')
    ).not.toBeNull();
  });
});
