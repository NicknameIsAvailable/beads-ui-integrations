/**
 * @import { Express, Request, Response } from 'express'
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { runBd, runBdJson } from './bd.js';
import { listIntegrations } from './integrations/registry.js';
import {
  getIntegrationStatusList,
  readIntegrations,
  saveYougileConnection
} from './integrations/store.js';
import {
  createYougileClient,
  fetchYougileList,
  normalizeYougileId,
  normalizeYougileList,
  normalizeYougileTitle,
  requestYougileApiKey
} from './integrations/yougile.js';
import {
  getAvailableWorkspaces,
  registerWorkspace
} from './registry-watcher.js';

/**
 * Create and configure the Express application.
 *
 * @param {{ host: string, port: number, app_dir: string, root_dir: string }} config - Server configuration.
 * @returns {Express} Configured Express app instance.
 */
export function createApp(config) {
  const app = express();

  // Basic hardening and config
  app.disable('x-powered-by');

  // Health endpoint
  /**
   * @param {Request} _req
   * @param {Response} res
   */
  app.get('/healthz', (_req, res) => {
    res.type('application/json');
    res.status(200).send({ ok: true });
  });

  // Enable JSON body parsing for API endpoints
  app.use(express.json());

  /**
   * Resolve the active workspace root for the request.
   *
   * @param {Request} req
   * @returns {string}
   */
  function resolveWorkspaceRoot(req) {
    const header_value = String(req.header('x-beads-workspace') || '').trim();
    if (!header_value) {
      return config.root_dir;
    }
    const resolved_path = path.resolve(header_value);
    const available = getAvailableWorkspaces();
    for (const workspace of available) {
      const workspace_root = path.resolve(workspace.path);
      if (resolved_path === workspace_root) {
        return workspace_root;
      }
      if (resolved_path.startsWith(workspace_root + path.sep)) {
        return workspace_root;
      }
    }
    return config.root_dir;
  }

  /**
   * Yougile integration status.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/status', (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const state = readIntegrations(root_dir);
    const yougile = state.yougile || null;
    res.status(200).json({
      ok: true,
      connected: Boolean(yougile && yougile.api_key),
      base_url: yougile?.base_url || 'https://yougile.com'
    });
  });

  /**
   * All integration statuses for the current workspace.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/status', (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const registry = listIntegrations();
    const statuses = getIntegrationStatusList(root_dir);
    res.status(200).json({
      ok: true,
      integrations: registry,
      statuses
    });
  });

  /**
   * Connect Yougile by exchanging credentials for an API key.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.post('/api/integrations/yougile/connect', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const body = req.body || {};
    const login = typeof body.login === 'string' ? body.login : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const company_id =
      typeof body.company_id === 'string' ? body.company_id : '';
    const api_key = typeof body.api_key === 'string' ? body.api_key : '';
    const base_url =
      typeof body.base_url === 'string' && body.base_url.trim().length > 0
        ? body.base_url
        : 'https://yougile.com';

    try {
      let resolved_key = api_key;
      if (!resolved_key) {
        if (!login || !password || !company_id) {
          res.status(400).json({
            ok: false,
            error: 'Missing login, password, or company_id'
          });
          return;
        }
        const result = await requestYougileApiKey({
          base_url,
          login,
          password,
          company_id
        });

        if (!result.ok) {
          res.status(result.status || 502).json({
            ok: false,
            error: result.error
          });
          return;
        }

        resolved_key = extractYougileApiKey(result.data);
        if (!resolved_key) {
          res.status(502).json({
            ok: false,
            error: 'Missing API key in Yougile response'
          });
          return;
        }
      }

      const saved = saveYougileConnection(root_dir, {
        api_key: resolved_key,
        base_url,
        company_id: company_id || null
      });
      res.status(200).json({
        ok: true,
        connected: true,
        base_url: saved.base_url,
        connected_at: saved.connected_at
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err && /** @type {any} */ (err).message
      });
    }
  });

  /**
   * List Yougile projects for the current workspace.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/projects', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const team_id = String(req.query.team_id || '');
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });
    // no-op: severity map not needed for projects list

    const result = await fetchYougileList(client, ['/projects', '/project']);
    if (!result.ok) {
      res.status(result.status || 502).json({ ok: false, error: result.error });
      return;
    }
    const items = normalizeYougileList(result.data);
    const raw_projects = items
      .map((item) => {
        const any = /** @type {any} */ (item);
        return {
          id: normalizeYougileId(any.id || any.Id || ''),
          title: normalizeYougileTitle(any.title || any.Title || ''),
          team_id: normalizeYougileId(
            any.teamId ||
              any.team_id ||
              any.departmentId ||
              any.department_id ||
              any.projectGroupId ||
              any.project_group_id ||
              ''
          ),
          users: normalizeYougileUserIds(any.users || any.Users || {})
        };
      })
      .filter((project) => project.id.length > 0);

    if (!team_id) {
      res.status(200).json({
        ok: true,
        projects: raw_projects.map((p) => ({ id: p.id, title: p.title })),
        filtered: false
      });
      return;
    }

    const teams = await fetchYougileTeams(client);
    const team = teams.find((t) => t.id === team_id);
    const filtered_projects = filterProjectsByTeam(raw_projects, team_id, team);
    res.status(200).json({
      ok: true,
      projects: filtered_projects.map((p) => ({ id: p.id, title: p.title })),
      filtered: true
    });
  });

  /**
   * List Yougile teams (departments).
   *
   * @param {Request} _req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/teams', async (_req, res) => {
    const root_dir = resolveWorkspaceRoot(_req);
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    const teams = await fetchYougileTeams(client);
    res.status(200).json({
      ok: true,
      teams: teams.map((team) => ({
        id: team.id,
        title: team.title
      }))
    });
  });

  /**
   * List Yougile boards (tabs) for a project.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/boards', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const project_id = String(req.query.project_id || '');
    if (!project_id) {
      res.status(400).json({ ok: false, error: 'Missing project_id' });
      return;
    }
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    const boards_result = await fetchYougileBoardsForProject(
      client,
      project_id
    );
    if (!boards_result.ok) {
      res.status(boards_result.status || 502).json({
        ok: false,
        error: boards_result.error
      });
      return;
    }
    const boards = normalizeYougileBoards(boards_result.data);
    const filtered = boards.filter((board) => board.project_id === project_id);
    res.status(200).json({ ok: true, boards: filtered });
  });

  /**
   * List Yougile columns for a given project (boards -> columns).
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/columns', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const project_id = String(req.query.project_id || '');
    const board_id = String(req.query.board_id || '');
    if (!project_id && !board_id) {
      res
        .status(400)
        .json({ ok: false, error: 'Missing project_id or board_id' });
      return;
    }
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    /** @type {Map<string, string>} */
    const board_title_by_id = new Map();
    /** @type {Set<string>} */
    const allowed_board_ids = new Set();
    /** @type {Array<{ id: string, title: string, project_id: string }>} */
    let boards = [];
    if (board_id) {
      allowed_board_ids.add(board_id);
    }
    if (!board_id && project_id) {
      const boards_result = await fetchYougileBoardsForProject(
        client,
        project_id
      );
      if (!boards_result.ok) {
        res.status(boards_result.status || 502).json({
          ok: false,
          error: boards_result.error
        });
        return;
      }
      boards = normalizeYougileBoards(boards_result.data);
      for (const board of boards) {
        board_title_by_id.set(board.id, board.title);
        if (board.project_id === project_id) {
          allowed_board_ids.add(board.id);
        }
      }
    }

    /** @type {Array<{ id: string, title: string, board_id: string, board_title: string }>} */
    let columns = [];
    if (board_id) {
      const columns_result = await fetchYougileColumnsForBoard(
        client,
        board_id
      );
      if (!columns_result.ok) {
        res.status(columns_result.status || 502).json({
          ok: false,
          error: columns_result.error
        });
        return;
      }
      columns = normalizeYougileColumns(
        columns_result.data,
        board_title_by_id
      ).filter((column) => column.board_id === board_id);
    } else if (allowed_board_ids.size > 0) {
      for (const board of boards) {
        if (!allowed_board_ids.has(board.id)) {
          continue;
        }
        const columns_result = await fetchYougileColumnsForBoard(
          client,
          board.id
        );
        if (!columns_result.ok) {
          res.status(columns_result.status || 502).json({
            ok: false,
            error: columns_result.error
          });
          return;
        }
        const next = normalizeYougileColumns(
          columns_result.data,
          board_title_by_id
        );
        columns = columns.concat(
          next.map((column) => ({
            ...column,
            board_title: column.board_title || board.title
          }))
        );
      }
    }

    res.status(200).json({ ok: true, columns });
  });

  /**
   * Debug endpoint: list all Yougile columns without filtering.
   *
   * @param {Request} _req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/columns-all', async (_req, res) => {
    const root_dir = resolveWorkspaceRoot(_req);
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    const columns_result = await fetchYougileList(client, [
      '/columns',
      '/column'
    ]);
    if (!columns_result.ok) {
      res.status(columns_result.status || 502).json({
        ok: false,
        error: columns_result.error
      });
      return;
    }
    const columns = normalizeYougileList(columns_result.data);
    res.status(200).json({ ok: true, count: columns.length, columns });
  });

  /**
   * List Yougile users (optionally filtered by project).
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/users', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const project_id = String(req.query.project_id || '');
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    const users_result = await fetchYougileList(client, ['/users', '/user']);
    if (!users_result.ok) {
      res.status(users_result.status || 502).json({
        ok: false,
        error: users_result.error
      });
      return;
    }
    const users_raw = normalizeYougileList(users_result.data);
    const users = users_raw
      .map((item) => {
        const any = /** @type {any} */ (item);
        const id = normalizeYougileId(any.id || any.Id || '');
        return {
          id,
          name: buildYougileUserName(any)
        };
      })
      .filter((user) => user.id.length > 0);

    if (!project_id) {
      res.status(200).json({ ok: true, users, filtered: false });
      return;
    }

    const project_user_ids = await fetchYougileProjectUserIds(
      client,
      project_id
    );
    if (!project_user_ids) {
      res.status(200).json({ ok: true, users, filtered: false });
      return;
    }
    const filtered_users = users.filter((user) =>
      project_user_ids.has(user.id)
    );
    res.status(200).json({
      ok: true,
      users: filtered_users,
      filtered: true
    });
  });

  /**
   * List Yougile stickers and their values.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/stickers', async (_req, res) => {
    const root_dir = resolveWorkspaceRoot(_req);
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    const text_stickers_result = await fetchYougileList(client, [
      '/string-stickers',
      '/string-sticker'
    ]);
    if (!text_stickers_result.ok) {
      res.status(text_stickers_result.status || 502).json({
        ok: false,
        error: text_stickers_result.error
      });
      return;
    }
    const text_stickers = normalizeYougileList(text_stickers_result.data).map(
      (item) => {
        const any = /** @type {any} */ (item);
        return {
          id: normalizeYougileId(any.id || any.Id || ''),
          title: normalizeYougileTitle(
            any.title || any.Title || any.name || ''
          ),
          raw_states: Array.isArray(any.states) ? any.states : []
        };
      }
    );

    /** @type {Array<{ id: string, title: string, values: Array<{ id: string, title: string }> }>} */
    const stickers = [];
    for (const sticker of text_stickers) {
      if (!sticker.id) {
        continue;
      }
      /** @type {Array<{ id: string, title: string }>} */
      let values = [];
      if (sticker.raw_states.length > 0) {
        values = sticker.raw_states
          .map((/** @type {any} */ state) => {
            const any = /** @type {any} */ (state);
            return {
              id: normalizeYougileId(any.id || any.Id || ''),
              title: normalizeYougileTitle(
                any.title || any.Title || any.name || ''
              )
            };
          })
          .filter((/** @type {{ id: string }} */ val) => val.id.length > 0);
      } else {
        const states_result = await fetchYougileList(client, [
          `/string-stickers/${sticker.id}/states`,
          `/string-sticker/${sticker.id}/states`
        ]);
        if (states_result.ok) {
          const states = normalizeYougileList(states_result.data);
          values = states
            .map((/** @type {any} */ state) => {
              const any = /** @type {any} */ (state);
              return {
                id: normalizeYougileId(any.id || any.Id || ''),
                title: normalizeYougileTitle(
                  any.title || any.Title || any.name || ''
                )
              };
            })
            .filter((/** @type {{ id: string }} */ val) => val.id.length > 0);
        }
      }
      stickers.push({
        id: sticker.id,
        title: sticker.title,
        values
      });
    }

    res.status(200).json({ ok: true, stickers });
  });

  /**
   * Preview tasks to be imported based on selection.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/preview', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const column_ids_raw = String(req.query.column_ids || '');
    if (!column_ids_raw) {
      res.status(400).json({ ok: false, error: 'Missing column_ids' });
      return;
    }
    const assignee_ids = splitIds(String(req.query.assignee_ids || ''));
    const sticker_value_ids = splitIds(
      String(req.query.sticker_value_ids || '')
    );
    const column_ids = splitIds(column_ids_raw);
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    /** @type {Array<{ id: string, title: string, description: string, body: string, link: string, column_id: string }>} */
    const tasks = [];
    for (const column_id of column_ids) {
      const tasks_result = await fetchYougileTasks(client, column_id);
      if (!tasks_result.ok) {
        res.status(tasks_result.status || 502).json({
          ok: false,
          error: tasks_result.error
        });
        return;
      }
      const items = normalizeYougileList(tasks_result.data);
      for (const item of items) {
        const task_info = normalizeYougileTaskInfo(
          item,
          yougile.base_url,
          yougile.company_id || ''
        );
        if (!task_info) {
          continue;
        }
        if (
          !passesYougileTaskFilters(task_info, assignee_ids, sticker_value_ids)
        ) {
          continue;
        }
        tasks.push({
          id: task_info.id,
          title: task_info.title,
          description: task_info.description,
          body: task_info.body,
          link: task_info.link,
          column_id
        });
      }
    }
    res.status(200).json({ ok: true, tasks });
  });

  /**
   * Find a single Yougile task by id within a board.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/task-search', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const board_id = String(req.query.board_id || '').trim();
    const task_id_raw = String(req.query.task_id || '').trim();
    const normalized_task_id = normalizeYougileId(task_id_raw) || task_id_raw;
    if (!normalized_task_id) {
      res.status(400).json({ ok: false, error: 'Missing task_id' });
      return;
    }
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    /** @type {Array<{ id: string, title: string, board_id: string, board_title: string, project_id: string }>} */
    let columns = [];
    /** @type {Map<string, string>} */
    let column_title_by_id = new Map();
    /** @type {Set<string> | null} */
    let column_ids = null;
    if (board_id) {
      const columns_result = await fetchYougileColumnsForBoard(
        client,
        board_id
      );
      if (!columns_result.ok) {
        res.status(columns_result.status || 502).json({
          ok: false,
          error: columns_result.error
        });
        return;
      }

      columns = normalizeYougileColumns(columns_result.data, new Map()).filter(
        (column) => column.board_id === board_id
      );
      column_title_by_id = new Map(
        columns.map((column) => [column.id, column.title || ''])
      );
      column_ids = new Set(columns.map((column) => column.id));
    }

    const direct_task = await fetchYougileTaskById(client, normalized_task_id);
    if (direct_task.ok) {
      const task_payload = extractYougileTaskPayload(direct_task.data);
      const task_any =
        task_payload && typeof task_payload === 'object' ? task_payload : {};
      const task_info = normalizeYougileTaskInfo(
        task_payload,
        yougile.base_url,
        yougile.company_id || ''
      );
      if (task_info) {
        let column_id = normalizeYougileId(
          task_any.columnId || task_any.column_id || task_any.ColumnId || ''
        );
        let board_id_from_task = normalizeYougileId(
          task_any.boardId || task_any.board_id || task_any.BoardId || ''
        );
        let project_id = normalizeYougileId(
          task_any.projectId || task_any.project_id || task_any.ProjectId || ''
        );
        if (column_id && (!board_id_from_task || !project_id)) {
          const all_columns = await fetchYougileColumnsAll(client);
          const match = all_columns.find((col) => col.id === column_id);
          if (match) {
            board_id_from_task = board_id_from_task || match.board_id;
            project_id = project_id || match.project_id;
          }
        }
        if (column_ids && column_id && !column_ids.has(column_id)) {
          res.status(200).json({ ok: true, task: null });
          return;
        }
        res.status(200).json({
          ok: true,
          task: {
            id: task_info.id,
            title: task_info.title,
            description: task_info.description,
            body: task_info.body,
            link: task_info.link,
            column_id,
            board_id: board_id_from_task,
            project_id,
            column_title: column_title_by_id.get(column_id) || ''
          }
        });
        return;
      }
    } else if (direct_task.status && direct_task.status !== 404) {
      res.status(direct_task.status || 502).json({
        ok: false,
        error: direct_task.error
      });
      return;
    }

    if (!board_id) {
      res.status(200).json({ ok: true, task: null });
      return;
    }

    for (const column of columns) {
      const tasks_result = await fetchYougileTasks(client, column.id);
      if (!tasks_result.ok) {
        res.status(tasks_result.status || 502).json({
          ok: false,
          error: tasks_result.error
        });
        return;
      }
      const items = normalizeYougileList(tasks_result.data);
      for (const item of items) {
        const task_info = normalizeYougileTaskInfo(
          item,
          yougile.base_url,
          yougile.company_id || ''
        );
        if (!task_info) {
          continue;
        }
        const normalized_id = normalizeYougileId(task_info.id);
        if (normalized_id !== normalized_task_id) {
          continue;
        }
        res.status(200).json({
          ok: true,
          task: {
            id: task_info.id,
            title: task_info.title,
            description: task_info.description,
            body: task_info.body,
            link: task_info.link,
            column_id: column.id,
            board_id,
            project_id: column.project_id || '',
            column_title: column_title_by_id.get(column.id) || ''
          }
        });
        return;
      }
      await delay(150);
    }

    res.status(200).json({ ok: true, task: null });
  });

  /**
   * Move a Yougile task to a new column.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.post('/api/integrations/yougile/move-task', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const task_id = String(body.task_id || '').trim();
    const column_id = String(body.column_id || '').trim();
    if (!task_id) {
      res.status(400).json({ ok: false, error: 'Missing task_id' });
      return;
    }
    if (!column_id) {
      res.status(400).json({ ok: false, error: 'Missing column_id' });
      return;
    }
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });
    const move_result = await moveYougileTaskToColumn(
      client,
      task_id,
      column_id
    );
    if (!move_result.ok) {
      res.status(move_result.status || 502).json({
        ok: false,
        error: move_result.error
      });
      return;
    }
    res.status(200).json({ ok: true });
  });

  /**
   * Debug endpoint: fetch all tasks without filters and log to server console.
   *
   * @param {Request} _req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/tasks-all', async (_req, res) => {
    const root_dir = resolveWorkspaceRoot(_req);
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });

    const result = await fetchYougileList(client, ['/tasks', '/task']);
    if (!result.ok) {
      res.status(result.status || 502).json({ ok: false, error: result.error });
      return;
    }
    const items = normalizeYougileList(result.data);
    console.log('[yougile] tasks-all count=%s', items.length);
    res.status(200).json({ ok: true, count: items.length, tasks: items });
  });

  /**
   * List Yougile tasks for a specific column.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.get('/api/integrations/yougile/tasks', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const column_id = String(req.query.column_id || '');
    if (!column_id) {
      res.status(400).json({ ok: false, error: 'Missing column_id' });
      return;
    }
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });
    const result = await fetchYougileTasks(client, column_id);
    if (!result.ok) {
      res.status(result.status || 502).json({ ok: false, error: result.error });
      return;
    }
    const items = normalizeYougileList(result.data);
    res.status(200).json({ ok: true, count: items.length, tasks: items });
  });

  /**
   * Import tasks from Yougile into local issues.
   *
   * @param {Request} req
   * @param {Response} res
   */
  app.post('/api/integrations/yougile/import', async (req, res) => {
    const root_dir = resolveWorkspaceRoot(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const column_ids = Array.isArray(body.column_ids)
      ? body.column_ids.map((/** @type {any} */ item) =>
          String(item || '').trim()
        )
      : [];
    const assignee_ids = Array.isArray(body.assignee_ids)
      ? body.assignee_ids
          .map((/** @type {any} */ item) => String(item || '').trim())
          .filter((/** @type {string} */ id) => id.length > 0)
      : [];
    const sticker_value_ids = Array.isArray(body.sticker_value_ids)
      ? body.sticker_value_ids
          .map((/** @type {any} */ item) => String(item || '').trim())
          .filter((/** @type {string} */ id) => id.length > 0)
      : [];
    const task_ids = Array.isArray(body.task_ids)
      ? body.task_ids
          .map((/** @type {any} */ item) => String(item || '').trim())
          .filter((/** @type {string} */ id) => id.length > 0)
      : [];
    const allowed_task_ids = task_ids.length > 0 ? new Set(task_ids) : null;
    const cleaned_columns = column_ids.filter(
      (/** @type {string} */ id) => id.length > 0
    );
    if (cleaned_columns.length === 0) {
      res.status(400).json({ ok: false, error: 'Missing column_ids' });
      return;
    }
    const yougile = readIntegrations(root_dir).yougile;
    if (!yougile || !yougile.api_key) {
      res.status(400).json({ ok: false, error: 'Yougile not connected' });
      return;
    }
    const client = createYougileClient({
      base_url: yougile.base_url,
      api_key: yougile.api_key
    });
    const severity_by_value_id = await fetchYougileSeverityValueMap(client);
    const sticker_value_map = await fetchYougileStickerValueMap(client);

    /** @type {Map<string, YougileTaskInfo>} */
    const tasks_by_id = new Map();
    for (const column_id of cleaned_columns) {
      const tasks_result = await fetchYougileTasks(client, column_id);
      if (!tasks_result.ok) {
        res.status(tasks_result.status || 502).json({
          ok: false,
          error: tasks_result.error
        });
        return;
      }
      const items = normalizeYougileList(tasks_result.data);
      for (const item of items) {
        const task_info = normalizeYougileTaskInfo(
          item,
          yougile.base_url,
          yougile.company_id || ''
        );
        if (!task_info) {
          continue;
        }
        if (allowed_task_ids && !allowed_task_ids.has(task_info.id)) {
          continue;
        }
        if (
          !passesYougileTaskFilters(task_info, assignee_ids, sticker_value_ids)
        ) {
          continue;
        }
        if (!tasks_by_id.has(task_info.id)) {
          tasks_by_id.set(task_info.id, task_info);
        }
      }
    }

    const tasks = Array.from(tasks_by_id.values());
    if (tasks.length === 0) {
      if (allowed_task_ids) {
        res.status(400).json({ ok: false, error: 'No tasks selected' });
        return;
      }
      res.status(200).json({ ok: true, created_count: 0 });
      return;
    }

    const default_priority = 2;
    /** @type {Array<{ id: string, title: string, error: string }>} */
    const errors = [];
    let created_count = 0;
    let skipped_count = 0;
    /** @type {Set<string>} */
    const existing_external_refs = await fetchExistingExternalRefs(root_dir);
    for (const task of tasks) {
      const title = task.title || task.id || 'Задача Yougile';
      const issue_body = buildYougileIssueBody(task);
      const labels = buildStickerLabels(task, sticker_value_map);
      const priority = resolveSeverityPriority(
        task,
        severity_by_value_id,
        default_priority
      );
      /** @type {string[]} */
      const args = ['create', title, '-t', 'task', '-p', String(priority)];
      if (task.id) {
        const external_ref = `yougile:${task.id}`;
        if (existing_external_refs.has(external_ref)) {
          skipped_count += 1;
          continue;
        }
        existing_external_refs.add(external_ref);
        args.push('--external-ref', external_ref);
      }
      if (issue_body) {
        args.push('-d', issue_body);
      }
      if (labels.length > 0) {
        args.push('-l', labels.join(','));
      }
      const result = await runBd(args, { cwd: root_dir });
      if (result.code !== 0) {
        errors.push({
          id: task.id,
          title,
          error: result.stderr || 'bd failed'
        });
        continue;
      }
      created_count += 1;
    }

    if (errors.length > 0) {
      res.status(207).json({
        ok: false,
        created_count,
        skipped_count,
        error_count: errors.length,
        errors
      });
      return;
    }
    res.status(200).json({ ok: true, created_count, skipped_count });
  });

  // Register workspace endpoint - allows CLI to register workspaces dynamically
  // when the server is already running
  /**
   * @param {Request} req
   * @param {Response} res
   */
  app.post('/api/register-workspace', (req, res) => {
    const { path: workspace_path, database } = req.body || {};
    if (!workspace_path || typeof workspace_path !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing or invalid path' });
      return;
    }
    if (!database || typeof database !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing or invalid database' });
      return;
    }
    registerWorkspace({ path: workspace_path, database });
    res.status(200).json({ ok: true, registered: workspace_path });
  });

  if (
    !fs.statSync(path.resolve(config.app_dir, 'main.bundle.js'), {
      throwIfNoEntry: false
    })
  ) {
    /**
     * On-demand bundle for the browser using esbuild.
     *
     * @param {Request} _req
     * @param {Response} res
     */
    app.get('/main.bundle.js', async (_req, res) => {
      try {
        const esbuild = await import('esbuild');
        const entry = path.join(config.app_dir, 'main.js');
        const result = await esbuild.build({
          entryPoints: [entry],
          bundle: true,
          format: 'esm',
          platform: 'browser',
          target: 'es2020',
          sourcemap: 'inline',
          minify: false,
          write: false
        });
        const out = result.outputFiles && result.outputFiles[0];
        if (!out) {
          res.status(500).type('text/plain').send('Bundle failed: no output');
          return;
        }
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(out.text);
      } catch (err) {
        res
          .status(500)
          .type('text/plain')
          .send('Bundle error: ' + (err && /** @type {any} */ (err).message));
      }
    });
  }

  // Static assets from /app
  app.use(express.static(config.app_dir));

  // Root serves index.html explicitly (even if static would catch it)
  /**
   * @param {Request} _req
   * @param {Response} res
   */
  app.get('/', (_req, res) => {
    const index_path = path.join(config.app_dir, 'index.html');
    res.sendFile(index_path);
  });

  return app;
}

/**
 * @param {unknown} data
 * @returns {string | null}
 */
function extractYougileApiKey(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const any =
    /** @type {{ key?: unknown, apiKey?: unknown, api_key?: unknown }} */ (
      data
    );
  if (typeof any.key === 'string' && any.key.length > 0) {
    return any.key;
  }
  if (typeof any.apiKey === 'string' && any.apiKey.length > 0) {
    return any.apiKey;
  }
  if (typeof any.api_key === 'string' && any.api_key.length > 0) {
    return any.api_key;
  }
  return null;
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} project_id
 * @returns {ReturnType<typeof fetchYougileList>}
 */
async function fetchYougileBoardsForProject(client, project_id) {
  /** @type {Array<{ path: string, query?: Record<string, string | number | boolean> }>} */
  const attempts = [
    { path: '/boards', query: { projectId: project_id } },
    { path: '/boards', query: { project_id } },
    { path: '/board', query: { projectId: project_id } },
    { path: '/board', query: { project_id } },
    { path: '/boards', query: undefined },
    { path: '/board', query: undefined }
  ];
  /** @type {Awaited<ReturnType<typeof fetchYougileList>>} */
  let last = {
    ok: false,
    status: 404,
    error: { code: 'yougile_not_found', message: 'Boards not found' }
  };
  for (const attempt of attempts) {
    const res = await client.request({
      path: attempt.path,
      query: attempt.query
    });
    if (res.ok) {
      return res;
    }
    last = res;
    if (res.status !== 404) {
      return res;
    }
  }
  return last;
}

/**
 * @param {unknown} data
 * @returns {Array<{ id: string, title: string, project_id: string }>}
 */
function normalizeYougileBoards(data) {
  const items = normalizeYougileList(data);
  return items
    .map((item) => {
      const any = /** @type {any} */ (item);
      return {
        id: normalizeYougileId(any.id || any.Id || ''),
        title: normalizeYougileTitle(any.title || any.Title || ''),
        project_id: normalizeYougileId(
          any.projectId || any.project_id || any.ProjectId || ''
        )
      };
    })
    .filter((board) => board.id.length > 0);
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} board_id
 * @returns {ReturnType<typeof fetchYougileList>}
 */
async function fetchYougileColumnsForBoard(client, board_id) {
  /** @type {Array<{ path: string, query?: Record<string, string | number | boolean> }>} */
  const attempts = [
    { path: '/columns', query: { boardId: board_id } },
    { path: '/columns', query: { board_id } },
    { path: '/column', query: { boardId: board_id } },
    { path: '/column', query: { board_id } }
  ];
  /** @type {Awaited<ReturnType<typeof fetchYougileList>>} */
  let last = {
    ok: false,
    status: 404,
    error: { code: 'yougile_not_found', message: 'Columns not found' }
  };
  for (const attempt of attempts) {
    const res = await client.request({
      path: attempt.path,
      query: attempt.query
    });
    if (res.ok) {
      return res;
    }
    last = res;
    if (res.status !== 404) {
      return res;
    }
  }
  return last;
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @returns {Promise<Array<{ id: string, title: string, board_id: string, board_title: string, project_id: string }>>}
 */
async function fetchYougileColumnsAll(client) {
  const columns_result = await fetchYougileList(client, [
    '/columns',
    '/column'
  ]);
  if (!columns_result.ok) {
    return [];
  }
  return normalizeYougileColumns(columns_result.data, new Map());
}

/**
 * @param {unknown} data
 * @param {Map<string, string>} board_title_by_id
 * @returns {Array<{ id: string, title: string, board_id: string, board_title: string, project_id: string }>}
 */
function normalizeYougileColumns(data, board_title_by_id) {
  const items = normalizeYougileList(data);
  return items
    .map((item) => {
      const any = /** @type {any} */ (item);
      const board_id = normalizeYougileId(
        any.boardId || any.board_id || any.BoardId || ''
      );
      const project_id = normalizeYougileId(
        any.projectId || any.project_id || any.ProjectId || ''
      );
      return {
        id: normalizeYougileId(any.id || any.Id || ''),
        title: normalizeYougileTitle(any.title || any.Title || ''),
        board_id,
        project_id,
        board_title: board_title_by_id.get(board_id) || ''
      };
    })
    .filter((column) => column.id.length > 0);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeYougileUserIds(value) {
  if (Array.isArray(value)) {
    return value.map((it) => normalizeYougileId(it)).filter((it) => it);
  }
  if (value && typeof value === 'object') {
    const ids = [];
    for (const key of Object.keys(value)) {
      if (normalizeYougileId(key)) {
        ids.push(normalizeYougileId(key));
      }
    }
    return ids;
  }
  return [];
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @returns {Promise<Array<{ id: string, title: string, user_ids: string[] }>>}
 */
async function fetchYougileTeams(client) {
  const result = await fetchYougileList(client, [
    '/departments',
    '/department',
    '/teams',
    '/team'
  ]);
  if (!result.ok) {
    return [];
  }
  const items = normalizeYougileList(result.data);
  return items
    .map((item) => {
      const any = /** @type {any} */ (item);
      return {
        id: normalizeYougileId(any.id || any.Id || ''),
        title: normalizeYougileTitle(any.title || any.Title || any.name || ''),
        user_ids: normalizeYougileUserIds(
          any.users || any.userIds || any.user_ids || any.Users || {}
        )
      };
    })
    .filter((team) => team.id.length > 0);
}

/**
 * @param {Array<{ id: string, title: string, team_id: string, users: string[] }>} projects
 * @param {string} team_id
 * @param {{ id: string, user_ids: string[] } | undefined} team
 * @returns {Array<{ id: string, title: string, team_id: string, users: string[] }>}
 */
function filterProjectsByTeam(projects, team_id, team) {
  if (projects.length === 0) {
    return [];
  }
  const direct = projects.filter((project) => project.team_id === team_id);
  if (direct.length > 0) {
    return direct;
  }
  if (!team || team.user_ids.length === 0) {
    return projects;
  }
  return projects.filter((project) =>
    project.users.some((user) => team.user_ids.includes(user))
  );
}

/**
 * @param {any} user
 * @returns {string}
 */
function buildYougileUserName(user) {
  const title = typeof user.title === 'string' ? user.title : '';
  if (title) {
    return title;
  }
  const name = typeof user.name === 'string' ? user.name : '';
  if (name) {
    return name;
  }
  const full = typeof user.fullName === 'string' ? user.fullName : '';
  if (full) {
    return full;
  }
  const first = typeof user.firstName === 'string' ? user.firstName : '';
  const last = typeof user.lastName === 'string' ? user.lastName : '';
  const combined = `${first} ${last}`.trim();
  if (combined) {
    return combined;
  }
  const login = typeof user.login === 'string' ? user.login : '';
  if (login) {
    return login;
  }
  const email = typeof user.email === 'string' ? user.email : '';
  return email || '';
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeYougileIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeYougileId(item)).filter((id) => id);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStickerValueIds(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const ids = [];
  for (const val of Object.values(/** @type {any} */ (value))) {
    const id = normalizeYougileId(val);
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * @typedef {Object} YougileTaskInfo
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} body
 * @property {string} link
 * @property {string[]} assigned_ids
 * @property {string[]} sticker_value_ids
 */

/**
 * @param {unknown} task
 * @param {string} base_url
 * @param {string} company_id
 * @returns {YougileTaskInfo | null}
 */
function normalizeYougileTaskInfo(task, base_url, company_id) {
  const any = /** @type {any} */ (task);
  const id = normalizeYougileId(any.id || any.Id || '');
  if (!id) {
    return null;
  }
  const title = normalizeYougileTitle(any.title || any.Title || '');
  const description = normalizeYougileTitle(
    any.description || any.Description || any.text || any.Text || ''
  );
  const link = buildYougileTaskLink(any, base_url, company_id);
  const body = buildYougileTaskBody(description, link);
  const assigned_ids = normalizeYougileIdList(
    any.assigned || any.Assigned || any.assigneeIds || any.assignee_ids || []
  );
  const sticker_value_ids = normalizeStickerValueIds(
    any.stickers || any.Stickers || {}
  );
  return {
    id,
    title,
    description,
    body,
    link,
    assigned_ids,
    sticker_value_ids
  };
}

/**
 * @param {YougileTaskInfo} task_info
 * @param {string[]} assignee_ids
 * @param {string[]} sticker_value_ids
 * @returns {boolean}
 */
function passesYougileTaskFilters(task_info, assignee_ids, sticker_value_ids) {
  if (assignee_ids.length > 0) {
    const has_assignee = task_info.assigned_ids.some((a) =>
      assignee_ids.includes(a)
    );
    if (!has_assignee) {
      return false;
    }
  }
  if (sticker_value_ids.length > 0) {
    const has_sticker = task_info.sticker_value_ids.some((v) =>
      sticker_value_ids.includes(v)
    );
    if (!has_sticker) {
      return false;
    }
  }
  return true;
}

/**
 * Fetch severity sticker states and build value-id -> title map.
 *
 * @param {ReturnType<typeof createYougileClient>} client
 * @returns {Promise<Map<string, string>>}
 */
async function fetchYougileSeverityValueMap(client) {
  const list_result = await fetchYougileList(client, [
    '/string-stickers',
    '/string-sticker'
  ]);
  if (!list_result.ok) {
    return new Map();
  }
  const items = normalizeYougileList(list_result.data);
  const severity_item = items.find((item) => {
    const any = /** @type {any} */ (item);
    const title_text = normalizeYougileTitle(
      any.title || any.Title || any.name || ''
    );
    return title_text.trim().toLowerCase() === 'severity';
  });
  if (!severity_item) {
    return new Map();
  }
  const severity_any = /** @type {any} */ (severity_item);
  const severity_id = normalizeYougileId(
    severity_any.id || severity_any.Id || ''
  );
  if (!severity_id) {
    return new Map();
  }
  /** @type {Array<{ id: string, title: string }>} */
  let states = Array.isArray(severity_any.states) ? severity_any.states : [];
  if (states.length === 0) {
    const states_result = await fetchYougileList(client, [
      `/string-stickers/${severity_id}/states`,
      `/string-sticker/${severity_id}/states`
    ]);
    if (!states_result.ok) {
      return new Map();
    }
    states = normalizeYougileList(states_result.data);
  }
  /** @type {Map<string, string>} */
  const severity_map = new Map();
  for (const state of states) {
    const any = /** @type {any} */ (state);
    const id = normalizeYougileId(any.id || any.Id || '');
    const title_text = normalizeYougileTitle(
      any.title || any.Title || any.name || ''
    );
    if (id) {
      severity_map.set(id, title_text);
    }
  }
  return severity_map;
}

/**
 * Fetch all sticker value states and build value-id -> label map.
 *
 * @param {ReturnType<typeof createYougileClient>} client
 * @returns {Promise<Map<string, { sticker_title: string, value_title: string }>>}
 */
async function fetchYougileStickerValueMap(client) {
  const list_result = await fetchYougileList(client, [
    '/string-stickers',
    '/string-sticker'
  ]);
  if (!list_result.ok) {
    return new Map();
  }
  const items = normalizeYougileList(list_result.data);
  /** @type {Map<string, { sticker_title: string, value_title: string }>} */
  const sticker_value_map = new Map();
  for (const item of items) {
    const any = /** @type {any} */ (item);
    const sticker_title = normalizeYougileTitle(
      any.title || any.Title || any.name || ''
    );
    const sticker_id = normalizeYougileId(any.id || any.Id || '');
    /** @type {Array<{ id: string, title: string }>} */
    let states = Array.isArray(any.states) ? any.states : [];
    if (states.length === 0 && sticker_id) {
      const states_result = await fetchYougileList(client, [
        `/string-stickers/${sticker_id}/states`,
        `/string-sticker/${sticker_id}/states`
      ]);
      if (!states_result.ok) {
        continue;
      }
      states = normalizeYougileList(states_result.data);
    }
    for (const state of states) {
      const state_any = /** @type {any} */ (state);
      const value_id = normalizeYougileId(state_any.id || state_any.Id || '');
      const value_title = normalizeYougileTitle(
        state_any.title || state_any.Title || state_any.name || ''
      );
      if (!value_id) {
        continue;
      }
      sticker_value_map.set(value_id, {
        sticker_title,
        value_title
      });
    }
  }
  return sticker_value_map;
}

/**
 * @param {YougileTaskInfo} task_info
 * @param {Map<string, string>} severity_by_value_id
 * @param {number} fallback_priority
 * @returns {number}
 */
function resolveSeverityPriority(
  task_info,
  severity_by_value_id,
  fallback_priority
) {
  if (!severity_by_value_id || severity_by_value_id.size === 0) {
    return fallback_priority;
  }
  /** @type {number[]} */
  const priority_values = [];
  for (const value_id of task_info.sticker_value_ids) {
    const title = severity_by_value_id.get(value_id);
    if (!title) {
      continue;
    }
    const mapped_priority = mapSeverityTitleToPriority(title);
    if (Number.isFinite(mapped_priority)) {
      priority_values.push(mapped_priority);
    }
  }
  if (priority_values.length === 0) {
    return fallback_priority;
  }
  return Math.min(...priority_values);
}

/**
 * @param {string} title
 * @returns {number}
 */
function mapSeverityTitleToPriority(title_text) {
  const normalized_text = title_text.trim().toLowerCase();
  if (!normalized_text) {
    return 2;
  }
  if (normalized_text === 'blocker') {
    return 0;
  }
  if (normalized_text === 'critical') {
    return 1;
  }
  if (normalized_text === 'major') {
    return 2;
  }
  if (normalized_text === 'minor') {
    return 3;
  }
  if (normalized_text === 'trivial') {
    return 4;
  }
  return 2;
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} column_id
 * @returns {ReturnType<typeof fetchYougileList>}
 */
async function fetchYougileTasks(client, column_id) {
  const limit = 1000;
  /** @type {Array<{ name: string, mode: 'offset'|'page'|'per_page' }>} */
  const strategies = [
    { name: 'offset', mode: 'offset' },
    { name: 'page', mode: 'page' },
    { name: 'per_page', mode: 'per_page' }
  ];
  const column_keys = ['columnId', 'column_id', 'column'];

  for (const strategy of strategies) {
    for (const column_key of column_keys) {
      const first = await requestYougileTasksPage(
        client,
        column_key,
        column_id,
        strategy.mode,
        1,
        limit
      );
      if (!first.ok) {
        if (first.status === 404) {
          continue;
        }
        return first;
      }
      const all = await fetchYougileTasksAllPages(
        client,
        column_key,
        column_id,
        strategy.mode,
        limit,
        first
      );
      return all;
    }
  }

  return {
    ok: false,
    status: 404,
    error: { code: 'yougile_not_found', message: 'Tasks not found' }
  };
}

/**
 * Fetch a single Yougile task by id using candidate paths.
 *
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} task_id
 * @returns {ReturnType<typeof fetchYougileList>}
 */
async function fetchYougileTaskById(client, task_id) {
  /** @type {Array<{ path: string }>} */
  const attempts = [
    { path: `/tasks/${task_id}` },
    { path: `/task/${task_id}` }
  ];
  /** @type {Awaited<ReturnType<typeof fetchYougileList>>} */
  let last = {
    ok: false,
    status: 404,
    error: { code: 'yougile_not_found', message: 'Task not found' }
  };
  for (const attempt of attempts) {
    const res = await client.request({ path: attempt.path });
    if (res.ok) {
      return res;
    }
    last = res;
    if (res.status !== 404) {
      return res;
    }
  }
  return last;
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} task_id
 * @param {string} column_id
 * @returns {ReturnType<typeof fetchYougileList>}
 */
async function moveYougileTaskToColumn(client, task_id, column_id) {
  /** @type {Array<{ path: string, method: 'PATCH' | 'PUT', body: Record<string, string> }>} */
  const attempts = [
    {
      path: `/tasks/${task_id}`,
      method: 'PATCH',
      body: { columnId: column_id }
    },
    {
      path: `/tasks/${task_id}`,
      method: 'PATCH',
      body: { column_id }
    },
    {
      path: `/task/${task_id}`,
      method: 'PATCH',
      body: { columnId: column_id }
    },
    {
      path: `/task/${task_id}`,
      method: 'PATCH',
      body: { column_id }
    },
    {
      path: `/tasks/${task_id}`,
      method: 'PUT',
      body: { columnId: column_id }
    },
    {
      path: `/tasks/${task_id}`,
      method: 'PUT',
      body: { column_id }
    },
    {
      path: `/task/${task_id}`,
      method: 'PUT',
      body: { columnId: column_id }
    },
    {
      path: `/task/${task_id}`,
      method: 'PUT',
      body: { column_id }
    }
  ];
  /** @type {Awaited<ReturnType<typeof fetchYougileList>>} */
  let last = {
    ok: false,
    status: 404,
    error: { code: 'yougile_not_found', message: 'Task not found' }
  };
  for (const attempt of attempts) {
    const res = await client.request({
      path: attempt.path,
      method: attempt.method,
      body: attempt.body
    });
    if (res.ok) {
      return res;
    }
    last = res;
    if (res.status !== 404) {
      return res;
    }
  }
  return last;
}

/**
 * @param {unknown} data
 * @returns {any}
 */
function extractYougileTaskPayload(data) {
  if (Array.isArray(data)) {
    return data[0];
  }
  if (data && typeof data === 'object') {
    const any = /** @type {any} */ (data);
    if (any.task) {
      return any.task;
    }
    if (any.Task) {
      return any.Task;
    }
    if (Array.isArray(any.items)) {
      return any.items[0];
    }
  }
  return data;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} column_key
 * @param {string} column_id
 * @param {'offset'|'page'|'per_page'} mode
 * @param {number} page
 * @param {number} limit
 * @returns {ReturnType<typeof fetchYougileList>}
 */
async function requestYougileTasksPage(
  client,
  column_key,
  column_id,
  mode,
  page,
  limit
) {
  const base_queries = [{ path: '/tasks' }, { path: '/task' }];
  const query = buildTaskQuery(column_key, column_id, mode, page, limit);
  /** @type {Awaited<ReturnType<typeof fetchYougileList>>} */
  let last = {
    ok: false,
    status: 404,
    error: { code: 'yougile_not_found', message: 'Tasks not found' }
  };
  for (const base of base_queries) {
    const res = await client.request({
      path: base.path,
      query
    });
    if (res.ok) {
      return res;
    }
    last = res;
    if (res.status !== 404) {
      return res;
    }
  }
  return last;
}

/**
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} column_key
 * @param {string} column_id
 * @param {'offset'|'page'|'per_page'} mode
 * @param {number} limit
 * @param {Awaited<ReturnType<typeof fetchYougileList>>} first
 * @returns {ReturnType<typeof fetchYougileList>}
 */
async function fetchYougileTasksAllPages(
  client,
  column_key,
  column_id,
  mode,
  limit,
  first
) {
  if (!first.ok) {
    return first;
  }
  /** @type {Map<string, unknown>} */
  const items_by_id = new Map();
  const first_items = normalizeYougileList(first.data);
  for (const item of first_items) {
    const any = /** @type {any} */ (item);
    const id = normalizeYougileId(any.id || any.Id || '');
    if (id) {
      items_by_id.set(id, item);
    }
  }
  const total = extractTotalCount(first.data);
  const max_pages = 50;
  let page = 2;
  let has_more = true;
  while (has_more && page <= max_pages) {
    const res = await requestYougileTasksPage(
      client,
      column_key,
      column_id,
      mode,
      page,
      limit
    );
    if (!res.ok) {
      if (res.status === 404) {
        break;
      }
      return res;
    }
    const page_items = normalizeYougileList(res.data);
    let new_count = 0;
    for (const item of page_items) {
      const any = /** @type {any} */ (item);
      const id = normalizeYougileId(any.id || any.Id || '');
      if (id && !items_by_id.has(id)) {
        items_by_id.set(id, item);
        new_count += 1;
      }
    }
    if (page_items.length < limit || new_count === 0) {
      has_more = false;
    }
    if (Number.isFinite(total)) {
      if (items_by_id.size >= total) {
        has_more = false;
      }
    }
    page += 1;
  }
  return {
    ok: true,
    status: 200,
    data: Array.from(items_by_id.values())
  };
}

/**
 * @param {string} column_key
 * @param {string} column_id
 * @param {'offset'|'page'|'per_page'} mode
 * @param {number} page
 * @param {number} limit
 * @returns {Record<string, string | number>}
 */
function buildTaskQuery(column_key, column_id, mode, page, limit) {
  /** @type {Record<string, string | number>} */
  const query = { [column_key]: column_id };
  if (mode === 'offset') {
    query.limit = limit;
    query.offset = (page - 1) * limit;
  } else if (mode === 'page') {
    query.limit = limit;
    query.page = page;
  } else {
    query.per_page = limit;
    query.page = page;
  }
  return query;
}

/**
 * @param {unknown} data
 * @returns {number}
 */
function extractTotalCount(data) {
  if (!data || typeof data !== 'object') {
    return NaN;
  }
  const any = /** @type {any} */ (data);
  const total =
    any.total ?? any.totalCount ?? any.total_count ?? any.count ?? any.Count;
  const num = Number(total);
  return Number.isFinite(num) ? num : NaN;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function splitIds(raw) {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * @param {any} task
 * @param {string} base_url
 * @param {string} company_id
 * @returns {string}
 */
function buildYougileTaskLink(task, base_url, company_id) {
  const url =
    typeof task.url === 'string'
      ? task.url
      : typeof task.link === 'string'
        ? task.link
        : typeof task.webUrl === 'string'
          ? task.webUrl
          : '';
  if (url) {
    return url;
  }
  const key =
    typeof task.key === 'string'
      ? task.key
      : typeof task.code === 'string'
        ? task.code
        : typeof task.shortId === 'string'
          ? task.shortId
          : typeof task.number === 'string'
            ? task.number
            : typeof task.number === 'number'
              ? String(task.number)
              : '';
  if (!key) {
    return '';
  }
  const origin = normalizeYougileUiBase(base_url);
  if (!company_id) {
    return `${origin}/#${encodeURIComponent(key)}`;
  }
  return `${origin}/team/${encodeURIComponent(company_id)}/#${encodeURIComponent(
    key
  )}`;
}

/**
 * @param {string} description
 * @param {string} link
 * @returns {string}
 */
function buildYougileTaskBody(description, link) {
  /** @type {string[]} */
  const parts = [];
  if (description) {
    parts.push(description.trim());
  }
  if (link) {
    parts.push(link.trim());
  }
  return parts.filter((part) => part.length > 0).join('\n\n');
}

/**
 * @param {YougileTaskInfo} task
 * @returns {string}
 */
function buildYougileIssueBody(task) {
  const base = task.body ? task.body.trim() : '';
  const id_line = task.id ? `Yougile ID: ${task.id}` : '';
  if (base && id_line) {
    return `${base}\n\n${id_line}`;
  }
  return base || id_line;
}

/**
 * @param {YougileTaskInfo} task
 * @param {Map<string, { sticker_title: string, value_title: string }>} value_map
 * @returns {string[]}
 */
function buildStickerLabels(task, value_map) {
  if (!task || !Array.isArray(task.sticker_value_ids)) {
    return [];
  }
  /** @type {string[]} */
  const labels = [];
  for (const value_id of task.sticker_value_ids) {
    const entry = value_map.get(value_id);
    if (!entry) {
      continue;
    }
    const sticker_title = String(entry.sticker_title || '').trim();
    const value_title = String(entry.value_title || '').trim();
    let label = '';
    if (sticker_title && value_title) {
      label = `${sticker_title}: ${value_title}`;
    } else {
      label = sticker_title || value_title;
    }
    if (!label) {
      continue;
    }
    const sanitized = sanitizeLabel(label);
    if (sanitized) {
      labels.push(sanitized);
    }
  }
  return Array.from(new Set(labels));
}

/**
 * @param {string} label
 * @returns {string}
 */
function sanitizeLabel(label) {
  const sanitized = label.replace(/\\s+/g, ' ').replace(/,/g, ' ').trim();
  return sanitized;
}

/**
 * @param {string} root_dir
 * @returns {Promise<Set<string>>}
 */
async function fetchExistingExternalRefs(root_dir) {
  /** @type {Set<string>} */
  const refs = new Set();
  const list_result = await runBdJson(['list', '--all', '--json', '-n', '0'], {
    cwd: root_dir
  });
  if (list_result.code !== 0 || !Array.isArray(list_result.stdoutJson)) {
    return refs;
  }
  for (const item of list_result.stdoutJson) {
    const any = /** @type {any} */ (item);
    const ref = String(any.external_ref || any.externalRef || '').trim();
    if (ref) {
      refs.add(ref);
    }
  }
  return refs;
}

/**
 * @param {string} base_url
 * @returns {string}
 */
function normalizeYougileUiBase(base_url) {
  if (!base_url) {
    return 'https://yougile.com';
  }
  let url = base_url.trim();
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  if (url.endsWith('/api-v2')) {
    url = url.slice(0, -7);
  }
  return url;
}

/**
 * Try to resolve project user ids via project roles endpoints.
 *
 * @param {ReturnType<typeof createYougileClient>} client
 * @param {string} project_id
 * @returns {Promise<Set<string> | null>}
 */
async function fetchYougileProjectUserIds(client, project_id) {
  /** @type {Array<{ paths: string[], query: Record<string, string | number | boolean> }>} */
  const attempts = [
    {
      paths: ['/project-roles', '/project-roles/list'],
      query: { projectId: project_id }
    },
    {
      paths: ['/project-roles', '/project-roles/list'],
      query: { project_id }
    }
  ];
  for (const attempt of attempts) {
    const result = await fetchYougileList(client, attempt.paths, attempt.query);
    if (!result.ok) {
      if (result.status !== 404) {
        return null;
      }
      continue;
    }
    const items = normalizeYougileList(result.data);
    /** @type {Set<string>} */
    const ids = new Set();
    for (const item of items) {
      const any = /** @type {any} */ (item);
      const user_id = normalizeYougileId(
        any.userId || any.user_id || any.UserId || ''
      );
      if (user_id) {
        ids.add(user_id);
        continue;
      }
      const nested = any.user && typeof any.user === 'object' ? any.user : null;
      const nested_id = normalizeYougileId(nested?.id || nested?.Id || '');
      if (nested_id) {
        ids.add(nested_id);
      }
    }
    return ids;
  }
  return null;
}
