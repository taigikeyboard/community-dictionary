#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TAG_NAMES, TAGS } from '../site/tags.js';
import { ITAIGI_URL, MIN_ROWS, parseItaigi } from './itaigi.js';

// One-off, run by the maintainer: downloads itaigi.tw's export, tags every (Hanji, Tâi-lô) pair
// and writes the committed snapshot data/itaigi.json [[hanji, tl, [tag name], [contributor]]] in
// export order (contributors as itaigi.tw names them, first seen first), which build-site turns into the site's search data. iTaigi no longer changes, so this runs only
// when the tags or the cleaning rules change. A pair the 教典 also lists takes the tags of its
// 教典 categories; the rest are classified by Claude through the `claude` CLI in batches from
// Hanji, Tâi-lô and the Mandarin gloss (which the snapshot leaves out). Answers are cached per
// word, so an interrupted run resumes where it stopped.
//
// usage: node scripts/import-itaigi.js [--cache <dir>] [--model sonnet] [--jobs 4]

const KAUTIAN_SHARD_URL = (n) => `https://taigikeyboard.tw/kautian-mirror/data/entries/${n}.json`;
const KAUTIAN_SHARDS = 61;
const BATCH_SIZE = 200;
const MAX_TAGS = 2;

// 教典 category → tag. Categories left out (stroke counts, 泛稱, 相關用語, …) say nothing about meaning.
const CATEGORY_TAGS = {
  生理構造: '身軀', 體態樣貌: '身軀', 傷疾病痛: '病疼', 醫療保健: '病疼',
  '食物、飲料、煙酒': '食食', 飲食行為: '食食', 飲食物具: '家私',
  '建築物、結構': '厝宅', 居住環境: '厝宅', '房屋租賃、搬遷': '厝宅',
  生活用品: '家私', 生產工具: '家私', 衣帽鞋襪: '家私', 珠寶飾品: '家私', '理容、化妝': '家私', 縫紉洗熨: '家私',
  '交通、運輸': '交通', '道路、橋梁': '交通', 旅運設施: '交通',
  天文: '自然', 地理: '自然', 自然現象: '自然', 氣候溫度: '自然', 資源礦物: '自然', 災禍: '自然',
  時間節令: '時間', 節氣: '時間',
  舊地名: '地號名', 山脈: '地號名', 河川: '地號名', 海港: '地號名', 廟宇: '地號名',
  魚蝦海獸: '動物', 禽類: '動物', 獸類: '動物', 昆蟲類: '動物', '爬蟲、兩棲類': '動物', 其他動物: '動物', '動物形體、行為': '動物',
  花草樹木: '植物', '植物形體、狀態': '植物', 蔬果作物: '植物',
  '宗族、家庭': '親情', 稱謂輩分: '親情', '性別、婚姻': '親情',
  '地位、身世、背景': '人物', '人種、民族': '人物',
  服務業及其他: '頭路', 軍公教業: '頭路', 農林業: '頭路', 漁牧業: '頭路',
  商業: '生理', '財務單位、活動': '生理', 錢財資產: '生理',
  政治: '社會', 法律: '社會', 外交: '社會', 軍事: '社會', '國家、社會、民眾': '社會', 組織團體: '社會',
  '教育、學術': '讀冊', '語言、文字、符號': '讀冊', 文教處所: '讀冊',
  '科技、工業': '科技', '郵電、網路': '科技',
  '體育、運動': '運動',
  '休閒、娛樂': '𨑨迌', '戲劇、音樂': '𨑨迌', '文學、藝術': '𨑨迌', 旅行: '𨑨迌',
  '神明、鬼怪、教派': '宗教', '神職、神巫、信徒': '宗教', 婚喪喜慶: '宗教',
  心理活動: '心情', 心理狀態: '心情', '反應、表情': '心情',
  個性風格: '性地', 氣質態度: '性地', 才智能力: '性地', 道德評價: '性地', 待人處事: '性地',
  '一般動詞-行為動詞': '動作', '一般動詞-靜態動詞': '動作', '一般動詞-活動動詞': '動作', 肢體動作: '動作', 感官動作: '動作', 生活勞動: '動作',
  '性質、程度': '形容', '顏色、氣味': '形容', '擬聲、擬態': '形容', '形貌、體積': '形容', '數詞、量詞': '形容',
  '境況、狀態-擬人': '形容', '境況、狀態-擬物': '形容', '境況、狀態-擬事': '形容',
  外來詞: '外來語',
};


// station-name categories (捷運 / 臺鐵 lines) and county names are place names too
export const isPlaceCategory = (category) => /捷運|輕軌|幹線|支線|南迴線|[縣市]$/.test(category);

const pairKey = (hanji, tl) => `${hanji}\t${tl}`;

// Tâi-lô without tone marks, case or separators, for matching 教典 readings. The nasal ⁿ and the
// dot above right (U+0358, POJ o͘) are letters, not tones, so they stay: "to͘h" and "toh" differ.
export const foldTl = (tl) =>
  tl
    .normalize('NFD')
    .replace(/[̀-͙͗-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z͘ⁿ]/g, '');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`import-itaigi: ${url} → HTTP ${res.status}`);
  return res.json();
}

// 教典 (Hanji, folded Tâi-lô) → tags from its categories. Shard entries: { hanzi, tl: [reading],
// category: "a,b" } (kautian-mirror scripts/build-entries.mjs).
async function loadKautianTags() {
  const byPair = new Map();
  for (let n = 0; n < KAUTIAN_SHARDS; n++) {
    for (const entry of Object.values(await fetchJson(KAUTIAN_SHARD_URL(n)))) {
      if (!entry?.category || !Array.isArray(entry.tl)) continue;
      const tags = new Set();
      for (const category of entry.category.split(',')) {
        const tag = CATEGORY_TAGS[category] ?? (isPlaceCategory(category) ? '地號名' : null);
        if (tag) tags.add(tag);
      }
      if (tags.size === 0) continue;
      for (const tl of entry.tl) byPair.set(`${entry.hanzi}|${foldTl(tl)}`, [...tags].slice(0, MAX_TAGS));
    }
  }
  return byPair;
}

const TAG_LINES = TAGS.map((tag) => `${tag.name}: ${tag.scope}`).join('\n');

function prompt(batch) {
  const wordLines = batch.map((w, i) => `${i}\t${w.hanji}\t${w.tl}\t${w.meanings.join('；')}`).join('\n');
  return `Classify Taiwanese (Taigi) words by meaning. Each line below is: index, Hanji, Tâi-lô, Mandarin gloss.

Tags (name: scope):
${TAG_LINES}

Give each word 1 or 2 tags that fit its meaning best, or none when no tag fits. Use only the tag names above, spelled exactly.
Reply with only a JSON object mapping each index to an array of tag names, for example {"0":["食食"],"1":[],"2":["動作","心情"]}. No prose, no code fence.

Words:
${wordLines}`;
}

// Claude's reply text → tags per word of the batch. Throws (so nothing is cached) when the reply
// is not the JSON object asked for or leaves a word out; unknown tag names are dropped.
export function parseAnswer(stdout, size) {
  let answer;
  try {
    answer = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1));
  } catch (err) {
    throw new Error(`reply is not JSON (${err.message}): ${stdout.slice(0, 200)}`);
  }
  return Array.from({ length: size }, (_, i) => {
    if (!Array.isArray(answer[i])) throw new Error(`reply has no tag list for word ${i}: ${stdout.slice(0, 200)}`);
    return [...new Set(answer[i].filter((t) => TAG_NAMES.includes(t)))].slice(0, MAX_TAGS);
  });
}

const run = promisify(execFile);

async function classifyBatch(batch, model) {
  const { stdout } = await run(
    'claude',
    ['-p', prompt(batch), '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text'],
    { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
  );
  return parseAnswer(stdout, batch.length);
}

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const cacheDir = option('cache', join(root, '.classify-cache'));
  const model = option('model', 'sonnet');
  const jobs = Number(option('jobs', '4'));
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`import-itaigi: --jobs must be a whole number ≥ 1, got "${option('jobs', '4')}"`);

  // One cache file per model and tag list: answers given for other tag scopes or another model
  // are never reused. Inside it, one answer per word, so upstream rows added or removed only send
  // the new words to Claude.
  const promptHash = createHash('sha256').update(TAG_LINES).digest('hex').slice(0, 12);
  const cacheFile = join(cacheDir, `${model}-${promptHash}.json`);
  await mkdir(cacheDir, { recursive: true });
  let cache = {};
  try {
    cache = JSON.parse(await readFile(cacheFile, 'utf8'));
  } catch {}

  const res = await fetch(ITAIGI_URL);
  if (!res.ok) throw new Error(`import-itaigi: ${ITAIGI_URL} → HTTP ${res.status}`);
  const parsed = parseItaigi(await res.text());
  if (parsed.length < MIN_ROWS) throw new Error(`import-itaigi: only ${parsed.length} rows (expected ≥ ${MIN_ROWS}); check ${ITAIGI_URL}`);
  const words = new Map();
  for (const [hanji, tl, meaning, contributor] of parsed) {
    const word = words.get(pairKey(hanji, tl)) ?? { hanji, tl, meanings: [], contributors: [] };
    if (meaning && !word.meanings.includes(meaning)) word.meanings.push(meaning);
    if (contributor && !word.contributors.includes(contributor)) word.contributors.push(contributor);
    words.set(pairKey(hanji, tl), word);
  }

  const kautian = await loadKautianTags();
  const tags = new Map();
  const rest = [];
  for (const [key, word] of words) {
    const known = word.tl.split('/').map((tl) => kautian.get(`${word.hanji}|${foldTl(tl)}`)).find(Boolean);
    if (known) tags.set(key, known);
    else if (cache[key]) tags.set(key, cache[key]);
    else rest.push(word);
  }
  console.log(`import-itaigi: ${words.size} pairs, ${tags.size} from 教典 or cache, ${rest.length} for Claude (${model})`);

  const batches = [];
  for (let i = 0; i < rest.length; i += BATCH_SIZE) batches.push(rest.slice(i, i + BATCH_SIZE));
  let next = 0;
  let failed = 0;
  let saving = Promise.resolve();
  const worker = async () => {
    while (next < batches.length) {
      const n = next++;
      const batch = batches[n];
      try {
        const result = await classifyBatch(batch, model);
        batch.forEach((w, i) => {
          tags.set(pairKey(w.hanji, w.tl), result[i]);
          cache[pairKey(w.hanji, w.tl)] = result[i];
        });
        // saves run one after another, so two finishing batches never interleave their writes
        saving = saving.then(() => writeFile(cacheFile, JSON.stringify(cache)));
        await saving;
        console.log(`import-itaigi: batch ${n + 1}/${batches.length} done`);
      } catch (err) {
        failed++;
        console.error(`import-itaigi: batch ${n + 1}/${batches.length} failed (${err.message.split('\n')[0]})`);
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));

  if (failed > 0) {
    console.error(`import-itaigi: ${failed} batches failed; data/itaigi.json left as it was. Rerun: answers so far are cached.`);
    process.exitCode = 1;
    return;
  }
  // one pair per line, so a rerun's diff shows which words or tags changed
  const snapshot = [...words.values()].map((w) => JSON.stringify([w.hanji, w.tl, tags.get(pairKey(w.hanji, w.tl)) ?? [], w.contributors]));
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data', 'itaigi.json'), `[\n${snapshot.join(',\n')}\n]\n`);
  console.log(`import-itaigi: ${snapshot.length} pairs → data/itaigi.json`);
}

if (import.meta.main) await main();
