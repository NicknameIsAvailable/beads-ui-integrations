import { describe, expect, test, vi } from 'vitest';
import { createImportDialog } from './import-dialog.js';

vi.mock('../data/import.js', () => ({
  fetchIntegrationsStatus: vi.fn(async () => ({
    ok: true,
    data: {
      integrations: [{ id: 'yougile', name: 'Yougile' }],
      statuses: [
        { id: 'yougile', connected: false, base_url: 'https://yougile.com' }
      ]
    }
  })),
  fetchIntegrationTeams: vi.fn(async () => ({ ok: true, data: { teams: [] } })),
  fetchIntegrationProjectsForTeam: vi.fn(async () => ({
    ok: true,
    data: { projects: [] }
  })),
  fetchIntegrationColumns: vi.fn(async () => ({
    ok: true,
    data: { columns: [] }
  })),
  fetchIntegrationUsers: vi.fn(async () => ({ ok: true, data: { users: [] } })),
  fetchIntegrationStickers: vi.fn(async () => ({
    ok: true,
    data: { stickers: [] }
  })),
  fetchIntegrationPreview: vi.fn(async () => ({
    ok: true,
    data: { tasks: [] }
  })),
  runImport: vi.fn(async () => ({ ok: true, data: {} }))
}));

describe('views/import-dialog', () => {
  test('shows empty state when no connected integrations', async () => {
    document.body.innerHTML = '<div id="m"></div>';

    const import_dialog = createImportDialog();
    import_dialog.open();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const empty_state = document.querySelector('.import-dialog__empty');
    expect(empty_state).not.toBeNull();
    expect(empty_state?.textContent || '').toContain(
      'Нет подключённых интеграций'
    );
  });
});
