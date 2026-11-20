// Line icons (24×24, 1.5 stroke, round caps) built with createElementNS — no HTML parsing.

const PATHS = {
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20'],
  compose: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  // categories
  waveform: ['M3 12h2', 'M7 8v8', 'M11 5v14', 'M15 9v6', 'M19 11v2', 'M21 12h0'],
  sparkles: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z'],
  bookPlus: ['M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4z', 'M5 18a2 2 0 0 1 2-2h11', 'M11.5 7v6', 'M8.5 10h6'],
  ellipsis: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  // variation types
  speaker: ['M4 10v4h3l5 4V6L7 10H4z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a7.5 7.5 0 0 1 0 11'],
  swap: ['M7 7h12', 'M16 4l3 3-3 3', 'M17 17H5', 'M8 14l-3 3 3 3'],
  question: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
  // about
  shield: ['M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z', 'M9 12l2 2 4-4'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z'],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  pin: ['M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const CATEGORY_ICONS = Object.freeze({
  'khiunn-khau': 'waveform',
  'sin-su': 'sparkles',
  'poo-tshiong': 'bookPlus',
  'ki-thann': 'ellipsis',
});

export const VARIATION_ICONS = Object.freeze({
  'gi-im': 'speaker',
  'su-lui': 'swap',
  'ki-thann': 'question',
});
