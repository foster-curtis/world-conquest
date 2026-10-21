import type { Color } from '@wc/engine';

/** Flat, color-blind-tuned fills; every badge also shows the owner's initial (SPEC 7.1). */
export const COLOR_HEX: Record<Color, string> = {
  red: '#d6453d',
  blue: '#3b7dd8',
  green: '#3fa066',
  yellow: '#e8b923',
  purple: '#8a5bc4',
  black: '#3a3f47',
  gray: '#9aa3ad',
};

export const COLOR_NAME: Record<Color, string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  purple: 'Purple',
  black: 'Black',
  gray: 'Gray',
};

/** Text color that stays readable on the fill. */
export const COLOR_INK: Record<Color, string> = {
  red: '#fff',
  blue: '#fff',
  green: '#fff',
  yellow: '#1c1c1c',
  purple: '#fff',
  black: '#fff',
  gray: '#1c1c1c',
};

export const PICKABLE_COLORS: Color[] = ['red', 'blue', 'green', 'yellow', 'purple', 'black'];
