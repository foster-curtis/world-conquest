import type { Color } from '@wc/engine';

/**
 * Player fills, mirrored from --player-* in styles/brand.css (SVG attributes can't
 * always take var(), and stats/replay canvases need real hex). Keep the two in sync.
 *
 * Chosen so every pair stays distinct under deuteranopia, protanopia and tritanopia
 * (closest pair: jade vs sky for tritan vision, ΔE 10), and every fill gives its text
 * color 5.3:1 or better. Three dark fills take white text, three light fills take ink,
 * so same-family pairs (cobalt / sky) differ in lightness, not just hue.
 * No yellow or orange: amber is the "your turn / selected" UI accent.
 * Army badges still show the owner's initial (SPEC 7.1), so color is never the only cue.
 */
export const COLOR_HEX: Record<Color, string> = {
  crimson: '#c23b3b',
  cobalt: '#2f63c4',
  jade: '#3fb98a',
  berry: '#a8327f',
  bone: '#e3e5e9',
  sky: '#7cc4f2',
  gray: '#3a404b', // neutral seat = unowned land
};

export const COLOR_NAME: Record<Color, string> = {
  crimson: 'Crimson',
  cobalt: 'Cobalt',
  jade: 'Jade',
  berry: 'Berry',
  bone: 'Bone',
  sky: 'Sky',
  gray: 'Neutral',
};

/** Text color on each fill (all ≥ 5.3:1). */
export const COLOR_INK: Record<Color, string> = {
  crimson: '#ffffff',
  cobalt: '#ffffff',
  jade: '#14161a',
  berry: '#ffffff',
  bone: '#14161a',
  sky: '#14161a',
  gray: '#ffffff',
};

/** Picker order = default assignment order: a 3-player game is crimson, cobalt, jade. */
export const PICKABLE_COLORS: Color[] = ['crimson', 'cobalt', 'jade', 'berry', 'bone', 'sky'];
