import { readFileSync, writeFileSync } from 'node:fs';

function upsert(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\s*$/, '')}\n${line}\n`;
}

const key = process.env.OPENAI_KEY_INPUT?.trim();
if (!key || !key.startsWith('sk-') || key.length < 20) {
  console.log(JSON.stringify({ ok: false, error: 'OPENAI_KEY_INPUT missing' }));
  process.exit(2);
}

let text = readFileSync('.env', 'utf8');
text = upsert(text, 'OPENAI_API_KEY', key);
text = upsert(text, 'OPENAI_MODEL', process.env.OPENAI_MODEL_INPUT?.trim() || 'gpt-4.1-mini');
text = upsert(text, 'VISION_PROVIDER', 'openai');
text = upsert(text, 'REQUIRE_REAL_VISION', 'true');
writeFileSync('.env', text);
console.log(
  JSON.stringify({
    ok: true,
    prefix: key.slice(0, 7),
    model: process.env.OPENAI_MODEL_INPUT?.trim() || 'gpt-4.1-mini',
  }),
);
