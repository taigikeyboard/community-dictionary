import { svg } from './dom.js';

// Line icons (24×24, 1.5 stroke, round caps) built as SVG elements — no HTML parsing.

const PATHS = {
  back: ['M15 5l-7 7 7 7'],
  check: ['M5.5 12.5l4 4 9-9.5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  copy: [
    'M10.75 8.5h6.5a2.25 2.25 0 0 1 2.25 2.25v6.5a2.25 2.25 0 0 1-2.25 2.25h-6.5a2.25 2.25 0 0 1-2.25-2.25v-6.5a2.25 2.25 0 0 1 2.25-2.25z',
    'M15.5 5.5v-.25A1.75 1.75 0 0 0 13.75 3.5h-7.5A1.75 1.75 0 0 0 4.5 5.25v7.5a1.75 1.75 0 0 0 1.75 1.75h.25',
  ],
  minus: ['M5 12h14'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20'],
  share: [
    'M12 14.5V3.5',
    'M8 7.25 12 3.25l4 4',
    'M8.5 10H6.75A1.75 1.75 0 0 0 5 11.75v7A1.75 1.75 0 0 0 6.75 20.5h10.5A1.75 1.75 0 0 0 19 18.75v-7A1.75 1.75 0 0 0 17.25 10H15.5',
  ],
};

export const icon = (name, className = 'icon') =>
  svg('svg', { viewBox: '0 0 24 24', class: className, 'aria-hidden': 'true' }, PATHS[name].map((d) => svg('path', { d })));
