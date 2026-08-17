import { describe, expect, it } from 'vitest';
import {
  adobeCloudEvents,
  adobeCredentialsReady,
  adobeJobFromEvent,
  adobeWebhookChallenge,
  adobeWebhookUrl,
  dgrTextVariables,
} from './adobe-av.js';

describe('adobe av helpers', () => {
  it('builds the public webhook URL', () => {
    expect(adobeWebhookUrl('https://cenapronta.example/')).toBe(
      'https://cenapronta.example/api/adobe/events',
    );
  });

  it('reads the Adobe I/O challenge from query or JSON body', () => {
    expect(
      adobeWebhookChallenge({
        searchParams: new URLSearchParams('challenge=abc123'),
      }),
    ).toBe('abc123');
    expect(
      adobeWebhookChallenge({
        searchParams: new URLSearchParams(),
        body: { challenge: 'from-body' },
      }),
    ).toBe('from-body');
  });

  it('flattens single and batch CloudEvents', () => {
    const batch = adobeCloudEvents([
      {
        id: '1',
        type: 'dgr.job.completed',
        data: { value: { job_id: 'job-1', status: 'succeeded' } },
      },
    ]);
    expect(adobeJobFromEvent(batch[0]!).jobId).toBe('job-1');
    expect(adobeCredentialsReady({ clientId: 'x', clientSecret: 'y' })).toBe(true);
    expect(adobeCredentialsReady({ clientId: '', clientSecret: 'y' })).toBe(false);
  });

  it('maps title and CTA onto Essential Graphics controls', () => {
    expect(
      dgrTextVariables(
        [
          { variableId: 'v1', label: 'Title', type: 'text' },
          { variableId: 'v2', label: 'CTA Button', type: 'text' },
          { variableId: 'v3', label: 'Logo', type: 'image' },
        ],
        { title: 'Casa', cta: 'Peça já', lowerThird: 'Cozinha' },
      ),
    ).toEqual([
      { variableId: 'v1', text: 'Casa' },
      { variableId: 'v2', text: 'Peça já' },
    ]);
  });
});
