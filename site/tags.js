// Semantic tags, the homepage's bubbles, in this order. Every name is a headword of the Ministry of
// Education dictionary (教典), with its Tâi-lô reading; the name is also the key stored in entries
// and used in routes, so `ja` and `en` are display labels only (site/strings.js tagLabel).

export const TAGS = Object.freeze([
  { name: '身軀', tl: 'sin-khu', ja: '体', en: 'Body' },
  { name: '病疼', tl: 'pēnn-thiànn', ja: '病気', en: 'Illness' },
  { name: '食食', tl: 'tsia̍h-si̍t', ja: '食べ物', en: 'Food' },
  { name: '厝宅', tl: 'tshù-the̍h', ja: '住まい', en: 'Home' },
  { name: '家私', tl: 'ke-si', ja: '道具', en: 'Tools' },
  { name: '交通', tl: 'kau-thong', ja: '交通', en: 'Transport' },
  { name: '自然', tl: 'tsū-jiân', ja: '自然', en: 'Nature' },
  { name: '時間', tl: 'sî-kan', ja: '時間', en: 'Time' },
  { name: '地號名', tl: 'tē-hō-miâ', ja: '地名', en: 'Places' },
  { name: '動物', tl: 'tōng-bu̍t', ja: '動物', en: 'Animals' },
  { name: '植物', tl: 'si̍t-bu̍t', ja: '植物', en: 'Plants' },
  { name: '親情', tl: 'tshin-tsîng', ja: '親族', en: 'Family' },
  { name: '人物', tl: 'jîn-bu̍t', ja: '人', en: 'People' },
  { name: '頭路', tl: 'thâu-lōo', ja: '仕事', en: 'Work' },
  { name: '生理', tl: 'sing-lí', ja: '商売', en: 'Business' },
  { name: '社會', tl: 'siā-huē', ja: '社会', en: 'Society' },
  { name: '讀冊', tl: 'tha̍k-tsheh', ja: '学び', en: 'Learning' },
  { name: '科技', tl: 'kho-ki', ja: '科学技術', en: 'Technology' },
  { name: '運動', tl: 'ūn-tōng', ja: 'スポーツ', en: 'Sports' },
  { name: '𨑨迌', tl: 'tshit-thô', ja: '遊び', en: 'Leisure' },
  { name: '宗教', tl: 'tsong-kàu', ja: '宗教', en: 'Religion' },
  { name: '心情', tl: 'sim-tsîng', ja: '気持ち', en: 'Feelings' },
  { name: '性地', tl: 'sìng-tē', ja: '性格', en: 'Personality' },
  { name: '動作', tl: 'tōng-tsok', ja: '動作', en: 'Actions' },
  { name: '形容', tl: 'hîng-iông', ja: '形容', en: 'Descriptions' },
  { name: '俗語', tl: 'sio̍k-gí', ja: 'ことわざ', en: 'Sayings' },
  { name: '外來語', tl: 'guā-lâi-gí', ja: '外来語', en: 'Loanwords' },
]);

export const TAG_NAMES = Object.freeze(TAGS.map((tag) => tag.name));
