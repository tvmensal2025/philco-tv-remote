const base = process.env.LOAD_API_BASE ?? 'http://127.0.0.1:3000';
const paths = ['/api/live', '/api/ready'];
const samples = [];
const started = Date.now();
for (const path of paths) {
  const url = `${base}${path}`;
  const times = [];
  let errors = 0;
  for (let i = 0; i < 40; i += 1) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      times.push(Date.now() - t0);
      if (!res.ok) errors += 1;
    } catch {
      times.push(Date.now() - t0);
      errors += 1;
    }
  }
  times.sort((a, b) => a - b);
  samples.push({
    path,
    n: times.length,
    errors,
    p50: times[Math.floor(times.length * 0.5)] ?? null,
    p95: times[Math.floor(times.length * 0.95)] ?? null,
    p99: times[Math.floor(times.length * 0.99)] ?? null,
  });
}
const skipped = samples.every((item) => item.errors === item.n);
console.log(
  JSON.stringify(
    {
      pass: !skipped && samples.every((item) => item.errors === 0),
      skipped,
      base,
      elapsedMs: Date.now() - started,
      samples,
    },
    null,
    2,
  ),
);
if (skipped) process.exit(0);
process.exit(samples.every((item) => item.errors === 0) ? 0 : 2);
