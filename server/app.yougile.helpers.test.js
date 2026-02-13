import { describe, expect, test } from 'vitest';
import {
  buildYougileTaskUpdateBodies,
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
});
