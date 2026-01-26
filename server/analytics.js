import fs from 'node:fs';
import path from 'node:path';
import { runBdJson } from './bd.js';
import { resolveDbPath } from './db.js';

/**
 * @typedef {Object} AnalyticsEvent
 * @property {'status-change'} type
 * @property {number} ts
 * @property {string} issue_id
 * @property {string} from_status
 * @property {string} to_status
 * @property {string} assignee
 * @property {number} priority
 * @property {string} issue_type
 */

const PRIORITY_LABELS = ['Critical', 'High', 'Medium', 'Low', 'Backlog'];

/**
 * @param {string} root_dir
 * @returns {{ data_dir: string, events_path: string }}
 */
function getAnalyticsPaths(root_dir) {
  const resolved = resolveDbPath({ cwd: root_dir });
  const data_dir = path.dirname(resolved.path);
  return {
    data_dir,
    events_path: path.join(data_dir, 'analytics-events.jsonl')
  };
}

/**
 * @param {string} root_dir
 * @returns {AnalyticsEvent[]}
 */
export function readAnalyticsEvents(root_dir) {
  const { events_path } = getAnalyticsPaths(root_dir);
  if (!fs.existsSync(events_path)) {
    return [];
  }
  const raw = fs.readFileSync(events_path, 'utf8');
  const lines = raw.split(/\r?\n/);
  /** @type {AnalyticsEvent[]} */
  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = /** @type {AnalyticsEvent} */ (JSON.parse(trimmed));
      if (parsed && parsed.type === 'status-change') {
        events.push(parsed);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return events;
}

/**
 * @param {string} root_dir
 * @param {AnalyticsEvent} event
 */
export function appendAnalyticsEvent(root_dir, event) {
  const { data_dir, events_path } = getAnalyticsPaths(root_dir);
  fs.mkdirSync(data_dir, { recursive: true });
  fs.appendFileSync(events_path, `${JSON.stringify(event)}\n`, 'utf8');
}

/**
 * @param {any} before_issue
 * @param {any} after_issue
 * @returns {AnalyticsEvent | null}
 */
function buildStatusChangeEvent(before_issue, after_issue) {
  const before_status =
    before_issue && typeof before_issue.status === 'string'
      ? before_issue.status
      : '';
  const after_status =
    after_issue && typeof after_issue.status === 'string'
      ? after_issue.status
      : '';
  if (!before_status || !after_status || before_status === after_status) {
    return null;
  }
  const issue_id = String(after_issue.id || before_issue.id || '').trim();
  if (!issue_id) {
    return null;
  }
  const assignee = String(after_issue.assignee || '').trim();
  const priority_raw = Number(after_issue.priority);
  const priority = Number.isFinite(priority_raw) ? priority_raw : -1;
  const issue_type = String(after_issue.issue_type || '').trim();

  return {
    type: 'status-change',
    ts: Date.now(),
    issue_id,
    from_status: before_status,
    to_status: after_status,
    assignee: assignee || 'Unassigned',
    priority,
    issue_type: issue_type || 'unknown'
  };
}

/**
 * @param {string} root_dir
 * @param {any} before_issue
 * @param {any} after_issue
 */
export function recordStatusChange(root_dir, before_issue, after_issue) {
  const event = buildStatusChangeEvent(before_issue, after_issue);
  if (!event) {
    return;
  }
  appendAnalyticsEvent(root_dir, event);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'n/a';
  }
  const total_seconds = Math.round(ms / 1000);
  const minutes = Math.floor(total_seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const rem_hours = hours % 24;
    return rem_hours > 0 ? `${days}d ${rem_hours}h` : `${days}d`;
  }
  if (hours > 0) {
    const rem_minutes = minutes % 60;
    return rem_minutes > 0 ? `${hours}h ${rem_minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatPercent(value) {
  if (!Number.isFinite(value) || value < 0) {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
}

/**
 * @param {number} priority
 * @returns {string}
 */
function priorityLabel(priority) {
  if (Number.isInteger(priority) && priority >= 0 && priority < 5) {
    return PRIORITY_LABELS[priority];
  }
  return `P${priority}`;
}

/**
 * @param {string} root_dir
 * @returns {Promise<string>}
 */
export async function buildAnalyticsDashboard(root_dir) {
  const list_result = await runBdJson(['list', '--json'], { cwd: root_dir });
  if (!list_result || list_result.code !== 0 || !('stdoutJson' in list_result)) {
    const error_message = String(list_result?.stderr || 'bd list failed');
    return `<!doctype html><html><body><h1>Analytics Error</h1><pre>${escapeHtml(
      error_message
    )}</pre></body></html>`;
  }

  const issues = Array.isArray(list_result.stdoutJson)
    ? list_result.stdoutJson
    : [];
  const events = readAnalyticsEvents(root_dir);
  const sorted_events = events.slice().sort((a, b) => a.ts - b.ts);
  const tracking_since = sorted_events.length > 0 ? sorted_events[0].ts : null;

  /** @type {Array<any>} */
  const bugs = issues.filter(
    (issue) => String(issue.issue_type || '').toLowerCase() === 'bug'
  );

  /** @type {Map<string, AnalyticsEvent[]>} */
  const events_by_issue = new Map();
  for (const event of sorted_events) {
    if (event.issue_type !== 'bug') {
      continue;
    }
    const list = events_by_issue.get(event.issue_id) || [];
    list.push(event);
    events_by_issue.set(event.issue_id, list);
  }

  /** @type {Map<string, { closed_count: number, durations: number[], reopen_count: number, current_in_progress: number, max_in_progress: number }>} */
  const stats_by_assignee = new Map();

  /** @type {Map<string, number>} */
  const current_in_progress = new Map();
  for (const issue of bugs) {
    if (String(issue.status || '') !== 'in_progress') {
      continue;
    }
    const assignee = String(issue.assignee || 'Unassigned');
    current_in_progress.set(
      assignee,
      (current_in_progress.get(assignee) || 0) + 1
    );
  }

  /** @type {Map<string, number>} */
  const in_progress_counts = new Map();
  /** @type {Map<string, number>} */
  const max_in_progress = new Map();
  /** @type {Map<string, { assignee: string, in_progress: boolean }>} */
  const issue_progress_state = new Map();

  for (const event of sorted_events) {
    if (event.issue_type !== 'bug') {
      continue;
    }
    if (
      event.to_status === 'in_progress' &&
      event.from_status !== 'in_progress'
    ) {
      const current = issue_progress_state.get(event.issue_id);
      if (!current || !current.in_progress) {
        issue_progress_state.set(event.issue_id, {
          assignee: event.assignee || 'Unassigned',
          in_progress: true
        });
        const assignee = event.assignee || 'Unassigned';
        const next = (in_progress_counts.get(assignee) || 0) + 1;
        in_progress_counts.set(assignee, next);
        const max_seen = max_in_progress.get(assignee) || 0;
        if (next > max_seen) {
          max_in_progress.set(assignee, next);
        }
      }
    }
    if (
      event.from_status === 'in_progress' &&
      event.to_status !== 'in_progress'
    ) {
      const current = issue_progress_state.get(event.issue_id);
      if (current && current.in_progress) {
        const assignee = current.assignee || 'Unassigned';
        const next = (in_progress_counts.get(assignee) || 0) - 1;
        in_progress_counts.set(assignee, Math.max(0, next));
        issue_progress_state.set(event.issue_id, {
          assignee,
          in_progress: false
        });
      }
    }
  }

  const reopen_events = sorted_events.filter(
    (event) =>
      event.issue_type === 'bug' &&
      event.from_status === 'closed' &&
      event.to_status !== 'closed'
  );

  for (const event of reopen_events) {
    const assignee = event.assignee || 'Unassigned';
    const stat = stats_by_assignee.get(assignee) || {
      closed_count: 0,
      durations: [],
      reopen_count: 0,
      current_in_progress: 0,
      max_in_progress: 0
    };
    stat.reopen_count += 1;
    stats_by_assignee.set(assignee, stat);
  }

  for (const issue of bugs) {
    if (String(issue.status || '') !== 'closed') {
      continue;
    }
    const closed_at = Number(issue.closed_at);
    if (!Number.isFinite(closed_at) || closed_at <= 0) {
      continue;
    }
    const assignee = String(issue.assignee || 'Unassigned');
    const issue_events = events_by_issue.get(String(issue.id || '')) || [];
    const in_progress_events = issue_events.filter(
      (event) => event.to_status === 'in_progress'
    );
    const start_ts =
      in_progress_events.length > 0
        ? in_progress_events[0].ts
        : Number(issue.created_at) || closed_at;
    const duration_ms = Math.max(0, closed_at - start_ts);
    const stat = stats_by_assignee.get(assignee) || {
      closed_count: 0,
      durations: [],
      reopen_count: 0,
      current_in_progress: 0,
      max_in_progress: 0
    };
    stat.closed_count += 1;
    if (duration_ms > 0) {
      stat.durations.push(duration_ms);
    }
    stats_by_assignee.set(assignee, stat);
  }

  for (const [assignee, count] of current_in_progress.entries()) {
    const stat = stats_by_assignee.get(assignee) || {
      closed_count: 0,
      durations: [],
      reopen_count: 0,
      current_in_progress: 0,
      max_in_progress: 0
    };
    stat.current_in_progress = count;
    stats_by_assignee.set(assignee, stat);
  }

  for (const [assignee, count] of max_in_progress.entries()) {
    const stat = stats_by_assignee.get(assignee) || {
      closed_count: 0,
      durations: [],
      reopen_count: 0,
      current_in_progress: 0,
      max_in_progress: 0
    };
    stat.max_in_progress = count;
    stats_by_assignee.set(assignee, stat);
  }

  /** @type {Map<number, { closed_count: number, reopen_count: number, durations: number[] }>} */
  const severity_stats = new Map();

  for (const issue of bugs) {
    if (String(issue.status || '') !== 'closed') {
      continue;
    }
    const priority = Number(issue.priority);
    const entry = severity_stats.get(priority) || {
      closed_count: 0,
      reopen_count: 0,
      durations: []
    };
    entry.closed_count += 1;
    const closed_at = Number(issue.closed_at);
    if (Number.isFinite(closed_at) && closed_at > 0) {
      const start_ts = Number(issue.created_at) || closed_at;
      entry.durations.push(Math.max(0, closed_at - start_ts));
    }
    severity_stats.set(priority, entry);
  }

  for (const event of reopen_events) {
    const priority = Number(event.priority);
    const entry = severity_stats.get(priority) || {
      closed_count: 0,
      reopen_count: 0,
      durations: []
    };
    entry.reopen_count += 1;
    severity_stats.set(priority, entry);
  }

  const assignee_rows = Array.from(stats_by_assignee.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([assignee, stat]) => {
      const avg_duration =
        stat.durations.length > 0
          ? stat.durations.reduce((sum, value) => sum + value, 0) /
            stat.durations.length
          : 0;
      return `<tr><td>${escapeHtml(assignee)}</td><td>${stat.closed_count}</td><td>${formatDuration(
        avg_duration
      )}</td><td>${stat.reopen_count}</td><td>${stat.current_in_progress}</td><td>${stat.max_in_progress}</td></tr>`;
    })
    .join('');

  const severity_rows = Array.from(severity_stats.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([priority, entry]) => {
      const avg_duration =
        entry.durations.length > 0
          ? entry.durations.reduce((sum, value) => sum + value, 0) /
            entry.durations.length
          : 0;
      const reopen_rate =
        entry.closed_count > 0
          ? entry.reopen_count / entry.closed_count
          : -1;
      return `<tr><td>${escapeHtml(
        priorityLabel(priority)
      )}</td><td>${entry.closed_count}</td><td>${entry.reopen_count}</td><td>${formatPercent(
        reopen_rate
      )}</td><td>${formatDuration(avg_duration)}</td></tr>`;
    })
    .join('');

  const total_bugs = bugs.length;
  const open_bugs = bugs.filter((issue) => issue.status === 'open').length;
  const in_progress_bugs = bugs.filter(
    (issue) => issue.status === 'in_progress'
  ).length;
  const closed_bugs = bugs.filter((issue) => issue.status === 'closed').length;

  const generated_at = new Date().toISOString();
  const tracking_text = tracking_since
    ? new Date(tracking_since).toISOString()
    : 'no events yet';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Beads Analytics Dashboard</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
        background: #f7f4ef;
        color: #1c1a17;
      }
      body {
        margin: 0;
        padding: 32px;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 16px;
        margin-bottom: 24px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        letter-spacing: 0.02em;
      }
      .meta {
        font-size: 12px;
        color: #5a534c;
      }
      section {
        background: #fffdf9;
        border: 1px solid #e6dfd6;
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 8px 24px rgba(62, 48, 36, 0.08);
      }
      h2 {
        margin-top: 0;
        font-size: 18px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #3a332b;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 16px;
      }
      .card {
        background: #f2ece3;
        padding: 16px;
        border-radius: 12px;
        border: 1px solid #e0d6c8;
      }
      .card strong {
        display: block;
        font-size: 18px;
        margin-top: 8px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th, td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid #efe8dd;
      }
      th {
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.08em;
        color: #5b544d;
      }
      .note {
        font-size: 12px;
        color: #5a534c;
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Beads Analytics Dashboard</h1>
      <div class="meta">
        Generated: ${escapeHtml(generated_at)}<br />
        Tracking since: ${escapeHtml(tracking_text)}
      </div>
    </header>
    <section>
      <h2>Bug Overview</h2>
      <div class="grid">
        <div class="card">Total bugs<strong>${total_bugs}</strong></div>
        <div class="card">Open<strong>${open_bugs}</strong></div>
        <div class="card">In progress<strong>${in_progress_bugs}</strong></div>
        <div class="card">Closed<strong>${closed_bugs}</strong></div>
      </div>
    </section>
    <section>
      <h2>Assignee Metrics (Bugs)</h2>
      <table>
        <thead>
          <tr>
            <th>Assignee</th>
            <th>Closed</th>
            <th>Avg cycle time</th>
            <th>Reopens</th>
            <th>Current WIP</th>
            <th>Max WIP</th>
          </tr>
        </thead>
        <tbody>
          ${assignee_rows || '<tr><td colspan="6">No data</td></tr>'}
        </tbody>
      </table>
      <div class="note">Reopen and max WIP counts are tracked from the first status-change event onward.</div>
    </section>
    <section>
      <h2>Severity vs Quality (Bugs)</h2>
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Closed</th>
            <th>Reopens</th>
            <th>Reopen rate</th>
            <th>Avg cycle time</th>
          </tr>
        </thead>
        <tbody>
          ${severity_rows || '<tr><td colspan="5">No data</td></tr>'}
        </tbody>
      </table>
      <div class="note">Severity is read from bd priority (0=Critical .. 4=Backlog).</div>
    </section>
  </body>
</html>`;
}
