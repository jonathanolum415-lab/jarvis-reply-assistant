import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeComposerText, handleComposerKeydown } from '../keyboard.js';

test('submitted composer text is consumed and cleared', () => {
  const input = { value: '  Message to reply to  ' };
  assert.equal(consumeComposerText(input), 'Message to reply to');
  assert.equal(input.value, '');
});

test('Enter generates a reply without requiring a modifier', () => {
  let generated = 0;
  let prevented = false;
  handleComposerKeydown({ key: 'Enter', shiftKey: false, preventDefault() { prevented = true; } }, () => generated++);
  assert.equal(generated, 1);
  assert.equal(prevented, true);
});

test('Shift+Enter keeps the native newline behavior', () => {
  let generated = 0;
  let prevented = false;
  handleComposerKeydown({ key: 'Enter', shiftKey: true, preventDefault() { prevented = true; } }, () => generated++);
  assert.equal(generated, 0);
  assert.equal(prevented, false);
});

test('other keys do not generate a reply', () => {
  let generated = 0;
  handleComposerKeydown({ key: 'a', shiftKey: false, preventDefault() { assert.fail('unexpected prevention'); } }, () => generated++);
  assert.equal(generated, 0);
});
