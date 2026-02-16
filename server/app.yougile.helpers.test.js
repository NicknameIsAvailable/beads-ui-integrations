import { describe, expect, test } from 'vitest';
import {
  buildYougileImportDateLabel,
  buildYougileImportLabels,
  buildYougileTaskUpdateBodies,
  extractYougileTaskIdFromInput,
  normalizeYougileComment,
  normalizeYougileComments
} from './app.js';

describe('yougile helper functions', () => {
  test('builds payload variants for title and description update', () => {
    const bodies = buildYougileTaskUpdateBodies({
      title: 'Task title',
      description: 'Task description'
    });

    expect(bodies).toEqual([
      { title: 'Task title', description: 'Task description' },
      { title: 'Task title', text: 'Task description' },
      { name: 'Task title', body: 'Task description' }
    ]);
  });

  test('normalizes a comment with nested author object', () => {
    const comment = normalizeYougileComment({
      id: 'cm-1',
      text: 'Looks good',
      author: { fullName: 'Alex Smith' },
      createdAt: '2026-02-13T08:00:00.000Z'
    });

    expect(comment).toEqual({
      id: 'cm-1',
      text: 'Looks good',
      author: 'Alex Smith',
      created_at: '2026-02-13T08:00:00.000Z'
    });
  });

  test('filters empty records while normalizing comment lists', () => {
    const comments = normalizeYougileComments({
      content: [
        { id: 'cm-1', text: 'First' },
        { id: '', text: '' },
        { id: 'cm-2', message: 'Second' }
      ]
    });

    expect(comments).toEqual([
      { id: 'cm-1', text: 'First', author: '', created_at: '' },
      { id: 'cm-2', text: 'Second', author: '', created_at: '' }
    ]);
  });

  test('extracts task id from canonical yougile link hash', () => {
    const task_id = extractYougileTaskIdFromInput(
      'https://ru.yougile.com/team/d8e5a52411d3/#DOC-519'
    );

    expect(task_id).toBe('DOC-519');
  });

  test('returns plain task id when input is not a link', () => {
    const task_id = extractYougileTaskIdFromInput('DOC-519');

    expect(task_id).toBe('DOC-519');
  });

  test('returns empty id when link has no task marker', () => {
    const task_id = extractYougileTaskIdFromInput(
      'https://ru.yougile.com/team/d8e5a52411d3/'
    );

    expect(task_id).toBe('');
  });

  test('builds import date label in yyyy-mm-dd format', () => {
    const label = buildYougileImportDateLabel(
      new Date('2026-02-13T10:11:12.000Z')
    );

    expect(label).toBe('imported:2026-02-13');
  });

  test('adds import date label to sticker labels without duplicates', () => {
    const labels = buildYougileImportLabels(
      {
        id: 'DOC-1',
        title: 'Task',
        description: '',
        body: '',
        link: '',
        assigned_ids: [],
        sticker_value_ids: ['severity_major']
      },
      new Map([
        [
          'severity_major',
          {
            sticker_title: 'severity',
            value_title: 'major'
          }
        ]
      ]),
      'imported:2026-02-13'
    );

    expect(labels).toEqual(['severity: major', 'imported:2026-02-13']);
  });
});
