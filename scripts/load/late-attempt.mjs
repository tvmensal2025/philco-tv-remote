import { canPromoteFinalOutput, executionObjectKeys } from '../../packages/shared/dist/scale.js';

const keys = executionObjectKeys('cenapronta/people/t/r/2026-08-13/reels/reel-1', 'exec-b');
const pass =
  canPromoteFinalOutput('exec-b', 'exec-b') &&
  !canPromoteFinalOutput('exec-b', 'exec-a') &&
  keys.canonicalVideo.endsWith('/reel.mp4') &&
  keys.stagingVideo.includes('/.exec/exec-b/');
console.log(
  JSON.stringify(
    {
      pass,
      lateAttemptBlocked: !canPromoteFinalOutput('exec-b', 'exec-a'),
      canonicalUnchanged: keys.canonicalVideo.endsWith('/reel.mp4'),
      note: 'REAL DB late-attempt remains NOT RUN here; this proves the commit gate. Pipeline uses the same helpers before copyObject + setStatus ready.',
    },
    null,
    2,
  ),
);
process.exit(pass ? 0 : 2);
