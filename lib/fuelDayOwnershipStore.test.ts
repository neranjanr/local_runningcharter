import { describe, it, expect, beforeEach } from 'vitest';
import {
  getFuelDayOwnership,
  getAllFuelDayOwnership,
  setFuelDayOwnership,
  clearFuelDayOwnership,
  clearAllFuelDayOwnership,
} from './fuelDayOwnershipStore';

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {}
  clearAllFuelDayOwnership();
});

describe('fuelDayOwnershipStore (ADR-0036)', () => {
  it('defaults every fuel-in date to previous', () => {
    expect(getFuelDayOwnership('2024-01-06')).toBe('previous');
    expect(getAllFuelDayOwnership()).toEqual({});
  });

  it('stores and reads a next join per fuel-in date', () => {
    setFuelDayOwnership('2024-01-06', 'next');
    expect(getFuelDayOwnership('2024-01-06')).toBe('next');
    expect(getFuelDayOwnership('2024-01-11')).toBe('previous');
    expect(getAllFuelDayOwnership()).toEqual({ '2024-01-06': 'next' });
  });

  it('clearing one date restores its default without touching others', () => {
    setFuelDayOwnership('2024-01-06', 'next');
    setFuelDayOwnership('2024-01-11', 'next');
    clearFuelDayOwnership('2024-01-06');
    expect(getFuelDayOwnership('2024-01-06')).toBe('previous');
    expect(getFuelDayOwnership('2024-01-11')).toBe('next');
  });

  it('persists across reads (localStorage or in-memory mirror)', () => {
    setFuelDayOwnership('2024-01-06', 'next');
    expect(getAllFuelDayOwnership()['2024-01-06']).toBe('next');
  });
});
