import type { QCClass } from '../types';

/** Curve colours chosen to stay distinguishable for common colour-vision deficiencies. */
export const CURVE_COLORS = ['#1F4E9C', '#D1495B', '#0F8B6E', '#8A5CC2', '#C28B00', '#2A9FD6', '#6B3E1F', '#4B5D73', '#B5367F', '#6B8E23'];

export const QC_COLORS: Record<QCClass, string> = {
  green: '#2E8B57',
  yellow: '#D9A400',
  orange: '#E07000',
  red: '#C62828',
};
