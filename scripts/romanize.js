import { convert } from '../vendor/taigi-converter/src/index.js';

// Tâi-lô → Pe̍h-ōe-jī and 方音符號 for display, computed at build time (the converter pulls a
// 1.5 MB dictionary module, too heavy for the browser).

function convertReading(tl, target) {
  try {
    return convert(tl, 'tl', target);
  } catch {
    return '';
  }
}

// The converter pads punctuation and tone-1 syllables ("ㄍㆤ  ， ㄒㄧㄣ" → "ㄍㆤ，ㄒㄧㄣ"), and
// passes a syllable it cannot parse through as tone-number Tâi-lô ("koo-chiáu" → "ㄍㆦ chiau2"):
// any Latin letter or digit left over means a half-converted reading, shown as none. A comma
// with no space after it ("thong,bān") hides the next syllable from the converter, so it gets one.
function toTps(tl) {
  const tps = convertReading(tl.replace(/,(?=\S)/g, ', '), 'zhuyin')
    .replace(/\s*([，。；？！、])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return /[A-Za-z0-9]/.test(tps) ? '' : tps;
}

// tl → { poj, tps }. "/"-joined variant readings (iTaigi) are converted one by one, since the
// converter does not split on "/". poj is "" when it equals tl; tps is "" when any variant
// does not convert cleanly.
export function romanize(tl) {
  const variants = tl.split('/').map((v) => v.trim());
  const poj = variants.map((v) => convertReading(v, 'poj'));
  const tps = variants.map(toTps);
  const joinedPoj = poj.includes('') ? '' : poj.join('/');
  return {
    poj: joinedPoj === variants.join('/') ? '' : joinedPoj,
    tps: tps.includes('') ? '' : tps.join(' / '),
  };
}
