import { describe, expect, test, vi } from 'vitest';
import { fetchIntegrationsStatus, runTaskLinkImport } from '../data/import.js';
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
  runImport: vi.fn(async () => ({ ok: true, data: {} })),
  runTaskLinkImport: vi.fn(async () => ({
    ok: true,
    data: { created: true, skipped: false }
  }))
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

  test('imports task by pasted link in quick mode', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const fetch_status = /** @type {import('vitest').Mock} */ (
      fetchIntegrationsStatus
    );
    fetch_status.mockResolvedValueOnce({
      ok: true,
      data: {
        integrations: [{ id: 'yougile', name: 'Yougile' }],
        statuses: [
          { id: 'yougile', connected: true, base_url: 'https://yougile.com' }
        ]
      }
    });

    const import_dialog = createImportDialog();
    import_dialog.open();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const input = /** @type {HTMLInputElement | null} */ (
      document.querySelector('.import-dialog__quick-input')
    );
    expect(input).not.toBeNull();
    if (!input) {
      return;
    }
    input.value = 'https://ru.yougile.com/team/d8e5a52411d3/#DOC-519';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const action_button = Array.from(document.querySelectorAll('button')).find(
      (button) =>
        (button.textContent || '').trim() === 'Импортировать по ссылке'
    );
    expect(action_button).not.toBeUndefined();
    if (!action_button) {
      return;
    }
    action_button.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const run_quick_import = /** @type {import('vitest').Mock} */ (
      runTaskLinkImport
    );
    expect(run_quick_import).toHaveBeenCalledWith('yougile', {
      task_input: 'https://ru.yougile.com/team/d8e5a52411d3/#DOC-519'
    });
  });
});
