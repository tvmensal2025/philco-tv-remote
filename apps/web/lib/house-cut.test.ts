import { describe, expect, it } from 'vitest';
import { humanAnalysis, houseCutTakes, isDissolveTransition } from './house-cut';

describe('house cut copy', () => {
  it('shows analysis and hides provider jargon', () => {
    const shown = humanAnalysis({
      analysis: 'Pão saindo do forno, movimento na balcão.',
      recommended_use: 'reel',
      confidence: 88,
    });
    expect(shown.analysis).toContain('Pão');
    expect(shown.use).toBe('Vale publicar no Instagram.');
    expect(shown.confidence).toBe('A casa ficou clara neste corte.');
  });

  it('drops provider names from the merchant text', () => {
    const hidden = humanAnalysis({
      analysis: 'openai gpt-4.1-mini scored the clip',
      recommended_use: 'skip',
      confidence: 40,
    });
    expect(hidden.analysis).toBe('');
    expect(hidden.use).toBe('Melhor não publicar este corte.');
    expect(hidden.confidence).toBe('O corte saiu, mas a imagem não estava tão clara.');
  });

  it('reads the short take list and dissolve joins', () => {
    const takes = houseCutTakes({
      house_cut: [
        {
          id: 'rec-1',
          reason: 'gancho',
          transition: 'dissolve',
          cropMode: 'pad_blur',
          camera: 'C1',
          duration: 8,
        },
      ],
    });
    expect(takes).toHaveLength(1);
    expect(isDissolveTransition(takes[0]?.transition)).toBe(true);
  });
});
