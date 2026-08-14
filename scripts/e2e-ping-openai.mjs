import { readFileSync, writeFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const key = env.OPENAI_API_KEY;
if (!key) {
  console.log(JSON.stringify({ ok: false, error: 'OPENAI_API_KEY missing' }));
  process.exit(2);
}

const models = [env.OPENAI_MODEL || 'gpt-4.1-mini', 'gpt-4o-mini'];
let lastError = '';
for (const model of models) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 40,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Responda SOMENTE JSON {"ok":true,"model":"nome"}' }],
    }),
  });
  const body = await res.json();
  if (res.ok) {
    console.log(
      JSON.stringify({
        ok: true,
        model,
        prefix: key.slice(0, 7),
        promptTokens: body.usage?.prompt_tokens,
        completionTokens: body.usage?.completion_tokens,
      }),
    );
    process.exit(0);
  }
  lastError = body.error?.message ?? `HTTP_${res.status}`;
  console.log(JSON.stringify({ tried: model, error: lastError }));
}
console.log(JSON.stringify({ ok: false, error: lastError }));
process.exit(1);
