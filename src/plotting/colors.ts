import type { QCClass } from '../types';

/** Curve colours chosen to stay distinguishable for common colour-vision deficiencies. */
export const CURVE_COLORS = ['#1F4E9C', '#D1495B', '#0F8B6E', '#8A5CC2', '#C28B00', '#2A9FD6', '#6B3E1F', '#4B5D73', '#B5367F', '#6B8E23'];

export const QC_COLORS: Record<QCClass, string> = {
  green: '#2E8B57',
  yellow: '#D9A400',
  orange: '#E07000',
  red: '#C62828',
};

/**
 * Pastel bar colours for comparison charts (periwinkle, coral, sand, then mint,
 * apricot, lavender, aqua, pink), drawn with a dark outline as in published tack plots.
 */
export const PASTEL_COLORS = ['#8E9AF3', '#EE7A74', '#E9C779', '#8ED1A2', '#F4AE72', '#B8A2E8', '#7DC8CC', '#F2A8C4'];
