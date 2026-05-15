import { describe, expect, it } from 'vitest';
import { Canvas } from './canvas.js';

describe('Canvas', () => {
  it('initializes filled with spaces (trimmed in toString)', () => {
    expect(new Canvas(3, 2).toString()).toBe('\n');
  });

  it('sets individual cells', () => {
    const c = new Canvas(3, 1);
    c.set(0, 0, 'a');
    c.set(2, 0, 'b');
    expect(c.toString()).toBe('a b');
  });

  it('writes a row of characters', () => {
    const c = new Canvas(5, 1);
    c.setRow(1, 0, 'hi');
    expect(c.toString()).toBe(' hi');
  });

  it('clamps out-of-bounds writes silently', () => {
    const c = new Canvas(2, 1);
    c.set(-1, 0, 'x');
    c.set(5, 0, 'y');
    c.set(0, -1, 'z');
    expect(c.toString()).toBe('');
  });

  it('preserves interior whitespace, only trimming the right edge', () => {
    const c = new Canvas(5, 1);
    c.set(0, 0, 'a');
    c.set(4, 0, 'b');
    expect(c.toString()).toBe('a   b');
  });

  it('reads back set cells via get', () => {
    const c = new Canvas(2, 1);
    c.set(0, 0, 'x');
    expect(c.get(0, 0)).toBe('x');
    expect(c.get(1, 0)).toBe(' ');
  });

  it('returns undefined for out-of-bounds get', () => {
    const c = new Canvas(2, 1);
    expect(c.get(-1, 0)).toBeUndefined();
    expect(c.get(2, 0)).toBeUndefined();
    expect(c.get(0, 1)).toBeUndefined();
  });
});
