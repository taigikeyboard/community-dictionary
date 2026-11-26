// Semantic tags, the homepage's bubbles, in this order. Every name is a headword of the Ministry of
// Education dictionary (教典), with its Tâi-lô reading; `scope` tells the build-time classifier
// (scripts/import-itaigi.js) what belongs under the tag and is never shown.

export const TAGS = Object.freeze([
  { name: '身軀', tl: 'sin-khu', scope: 'body parts, the body, physical appearance' },
  { name: '病疼', tl: 'pēnn-thiànn', scope: 'illness, injury, medicine, health care' },
  { name: '食食', tl: 'tsia̍h-si̍t', scope: 'food, drink, dishes, snacks, eating and cooking' },
  { name: '厝宅', tl: 'tshù-the̍h', scope: 'houses, buildings, rooms, furniture fixtures, living environment' },
  { name: '家私', tl: 'ke-si', scope: 'tools, utensils, household objects, clothing, accessories' },
  { name: '交通', tl: 'kau-thong', scope: 'vehicles, roads, transport, traffic, travel logistics' },
  { name: '自然', tl: 'tsū-jiân', scope: 'weather, sky, landforms, water, minerals, natural phenomena, disasters' },
  { name: '時間', tl: 'sî-kan', scope: 'time, dates, seasons, festivals, frequency' },
  { name: '地號名', tl: 'tē-hō-miâ', scope: 'place names, countries, cities, stations, named locations' },
  { name: '動物', tl: 'tōng-bu̍t', scope: 'animals, birds, fish, insects and their behaviour' },
  { name: '植物', tl: 'si̍t-bu̍t', scope: 'plants, trees, flowers, fruits and vegetables as plants, crops' },
  { name: '親情', tl: 'tshin-tsîng', scope: 'family, relatives, kinship terms, marriage' },
  { name: '人物', tl: 'jîn-bu̍t', scope: 'kinds of people, social roles, nationalities, groups of people, address terms' },
  { name: '頭路', tl: 'thâu-lōo', scope: 'jobs, occupations, work, workplaces' },
  { name: '生理', tl: 'sing-lí', scope: 'business, trade, shopping, money, prices, finance' },
  { name: '社會', tl: 'siā-huē', scope: 'politics, law, government, military, public affairs, organisations' },
  { name: '讀冊', tl: 'tha̍k-tsheh', scope: 'school, study, knowledge, academic subjects, language and writing' },
  { name: '科技', tl: 'kho-ki', scope: 'technology, computers, internet, phones, machines, science, industry' },
  { name: '運動', tl: 'ūn-tōng', scope: 'sports, exercise, games of skill' },
  { name: '𨑨迌', tl: 'tshit-thô', scope: 'leisure, entertainment, music, film, arts, hobbies, tourism' },
  { name: '宗教', tl: 'tsong-kàu', scope: 'religion, gods, spirits, temples, rituals, customs, ceremonies' },
  { name: '心情', tl: 'sim-tsîng', scope: 'feelings, emotions, mental states, reactions' },
  { name: '性地', tl: 'sìng-tē', scope: 'personality, character, attitude, abilities, behaviour toward others' },
  { name: '動作', tl: 'tōng-tsok', scope: 'actions and everyday verbs, body movements, activities' },
  { name: '形容', tl: 'hîng-iông', scope: 'qualities, states, degree, colour, smell, sound-imitating words, numbers and measures' },
  { name: '俗語', tl: 'sio̍k-gí', scope: 'proverbs, idioms, set phrases, slang expressions, greetings' },
  { name: '外來語', tl: 'guā-lâi-gí', scope: 'loanwords from Japanese, English or other languages' },
]);

export const TAG_NAMES = Object.freeze(TAGS.map((tag) => tag.name));
