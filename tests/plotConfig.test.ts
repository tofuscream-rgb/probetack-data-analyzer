import { describe, expect, it } from 'vitest';
import { safeDragmode } from '../src/plotting/PlotlyChart';

describe('graph drag mode', () => {
  it('never allows box or lasso selection; zoom is the default', () => {
    expect(safeDragmode('select')).toBe('zoom');
    expect(safeDragmode('lasso')).toBe('zoom');
    expect(safeDragmode(undefined)).toBe('zoom');
    expect(safeDragmode('zoom')).toBe('zoom');
    expect(safeDragmode('pan')).toBe('pan');
  });
});
