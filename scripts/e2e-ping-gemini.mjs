import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
console.log('prefix', String(env.GEMINI_API_KEY).slice(0, 4));
const models = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-pro',
];

for (const model of models) {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: 'Reply with the single word PONG.',
    });
    const text = (response.text ?? '').replace(/\s+/g, ' ').slice(0, 40);
    console.log('OK', model, text);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const short = message.includes('no longer available')
      ? 'unavailable'
      : message.includes('API_KEY_SERVICE_BLOCKED')
        ? 'blocked'
        : message.includes('not found') || message.includes('NOT_FOUND')
          ? 'not found'
          : message.slice(0, 160).replace(/\s+/g, ' ');
    console.log('NO', model, short);
  }
}
process.exit(2);
