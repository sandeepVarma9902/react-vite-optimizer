import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useUsers } from './UserList';

describe('useUsers', () => {
  it('is exported', () => {
    assert.equal(typeof useUsers, 'function');
  });
});
