import { describe, expect, it } from 'vitest';
import {
  normalizeLifecycleRules,
  RAW_RETENTION_RULE_ID,
  rawRetentionRule,
} from './storage-lifecycle.js';

describe('normalizeLifecycleRules', () => {
  it('turns a single MinIO rule object into an array', () => {
    const rules = normalizeLifecycleRules({
      Rule: {
        ID: RAW_RETENTION_RULE_ID,
        Status: 'Enabled',
        Filter: { Prefix: 'cenapronta/raw/' },
        Expiration: { Days: 7 },
      },
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.ID).toBe(RAW_RETENTION_RULE_ID);
  });

  it('keeps an array of rules', () => {
    const rules = normalizeLifecycleRules({
      Rule: [rawRetentionRule(7), { ID: 'other', Status: 'Enabled' }],
    });
    expect(rules.map((rule) => rule.ID)).toEqual([RAW_RETENTION_RULE_ID, 'other']);
  });
});
