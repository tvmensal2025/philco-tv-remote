import { describe, expect, it } from 'vitest';

describe('wame rest contract', () => {
  it('puts the instance key in the path, like iGreen', () => {
    const server = 'https://us.api-wa.me';
    const key = 'instance-key';
    expect(`${server}/${key}/message/video`).toBe(
      'https://us.api-wa.me/instance-key/message/video',
    );
    expect(`${server}/${key}/message/text`).toBe('https://us.api-wa.me/instance-key/message/text');
  });
});
