// Semantic tags, the homepage's bubbles, in this order. Every name is a headword of the Ministry of
// Education dictionary (教典), with its Tâi-lô reading; `hue` is the bubble's colour, one of nine
// glazes of Taiwanese majolica tiles (花磚; styles.css --hue-*), warm and cool in turn down the list
// so neighbours tend to differ; `scope` tells the build-time classifier (scripts/import-itaigi.js) what belongs under the
// tag and is never shown.

export const TAGS = Object.freeze([
  { name: '身軀', tl: 'sin-khu', hue: 'cobalt', scope: 'body parts, the body, physical appearance' },
  { name: '病疼', tl: 'pēnn-thiànn', hue: 'mustard', scope: 'illness, injury, medicine, health care' },
  { name: '食食', tl: 'tsia̍h-si̍t', hue: 'jade', scope: 'food, drink, dishes, snacks, eating and cooking' },
  { name: '厝宅', tl: 'tshù-the̍h', hue: 'coral', scope: 'houses, buildings, rooms, furniture fixtures, living environment' },
  { name: '家私', tl: 'ke-si', hue: 'aqua', scope: 'tools, utensils, household objects, clothing, accessories' },
  { name: '交通', tl: 'kau-thong', hue: 'brick', scope: 'vehicles, roads, transport, traffic, travel logistics' },
  { name: '自然', tl: 'tsū-jiân', hue: 'leaf', scope: 'weather, sky, landforms, water, minerals, natural phenomena, disasters' },
  { name: '時間', tl: 'sî-kan', hue: 'rose', scope: 'time, dates, seasons, festivals, frequency' },
  { name: '地號名', tl: 'tē-hō-miâ', hue: 'lime', scope: 'place names, countries, cities, stations, named locations' },
  { name: '動物', tl: 'tōng-bu̍t', hue: 'cobalt', scope: 'animals, birds, fish, insects and their behaviour' },
  { name: '植物', tl: 'si̍t-bu̍t', hue: 'mustard', scope: 'plants, trees, flowers, fruits and vegetables as plants, crops' },
  { name: '親情', tl: 'tshin-tsîng', hue: 'jade', scope: 'family, relatives, kinship terms, marriage' },
  { name: '人物', tl: 'jîn-bu̍t', hue: 'coral', scope: 'kinds of people, social roles, nationalities, groups of people, address terms' },
  { name: '頭路', tl: 'thâu-lōo', hue: 'aqua', scope: 'jobs, occupations, work, workplaces' },
  { name: '生理', tl: 'sing-lí', hue: 'brick', scope: 'business, trade, shopping, money, prices, finance' },
  { name: '社會', tl: 'siā-huē', hue: 'leaf', scope: 'politics, law, government, military, public affairs, organisations' },
  { name: '讀冊', tl: 'tha̍k-tsheh', hue: 'rose', scope: 'school, study, knowledge, academic subjects, language and writing' },
  { name: '科技', tl: 'kho-ki', hue: 'lime', scope: 'technology, computers, internet, phones, machines, science, industry' },
  { name: '運動', tl: 'ūn-tōng', hue: 'cobalt', scope: 'sports, exercise, games of skill' },
  { name: '𨑨迌', tl: 'tshit-thô', hue: 'mustard', scope: 'leisure, entertainment, music, film, arts, hobbies, tourism' },
  { name: '宗教', tl: 'tsong-kàu', hue: 'jade', scope: 'religion, gods, spirits, temples, rituals, customs, ceremonies' },
  { name: '心情', tl: 'sim-tsîng', hue: 'coral', scope: 'feelings, emotions, mental states, reactions' },
  { name: '性地', tl: 'sìng-tē', hue: 'aqua', scope: 'personality, character, attitude, abilities, behaviour toward others' },
  { name: '動作', tl: 'tōng-tsok', hue: 'brick', scope: 'actions and everyday verbs, body movements, activities' },
  { name: '形容', tl: 'hîng-iông', hue: 'leaf', scope: 'qualities, states, degree, colour, smell, sound-imitating words, numbers and measures' },
  { name: '俗語', tl: 'sio̍k-gí', hue: 'rose', scope: 'proverbs, idioms, set phrases, slang expressions, greetings' },
  { name: '外來語', tl: 'guā-lâi-gí', hue: 'lime', scope: 'loanwords from Japanese, English or other languages' },
]);

export const TAG_NAMES = Object.freeze(TAGS.map((tag) => tag.name));
