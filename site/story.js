import { h } from './dom.js';
import { contributorRoute, tagRoute } from './logic.js';

// The homepage's statistics under the bubble map (dist/stats.json, from scripts/stats.js), told as
// a scrolling story after iNaturalist's Year in Review and Bloomberg's graphics: each section states
// its finding as a headline over one chart, and rises into view when the reader scrolls to it, its
// bars growing and its big numbers counting up. Readers who ask for reduced motion get it all at once.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// a big number's count-up
const COUNT_MS = 900;

const number = (n) => n.toLocaleString('en-US');
const percent = (share) => `${(share * 100).toFixed(1)}%`;
const hueOf = (hue) => `var(--hue-${hue})`;

// loadStats() → stats.json; the sections arrive once it has loaded (nothing shows if it fails).
export function storySections(loadStats) {
  const root = h('div', { class: 'story' });
  loadStats()
    .then((stats) => {
      root.append(...sections(stats));
      reveal(root);
    })
    .catch(() => {});
  return root;
}

// One section: a small label, the finding as a headline, its chart, an optional note under it.
const section = (label, headline, chart, note = null) =>
  h('section', { class: 'story-section' }, h('p', { class: 'story-label' }, label), h('h2', { class: 'story-headline' }, headline), chart, note ? h('p', { class: 'story-note' }, note) : null);

// A ranked bar: its label (a link when `href`), a track filled to `share`, its count.
const bar = ({ label, href, share, count, color, index }) =>
  h(
    'li',
    { class: 'story-bar', style: `--share: ${share}; --i: ${index}; --bar: ${color}` },
    href ? h('a', { class: 'story-bar-label', href }, label) : h('span', { class: 'story-bar-label' }, label),
    h('span', { class: 'story-bar-track' }, h('span', { class: 'story-bar-fill' })),
    h('span', { class: 'story-bar-count' }, number(count)),
  );

function sections(stats) {
  const hueByTag = new Map(stats.perTag.map((tag) => [tag.name, tag.hue]));
  const [topTag] = stats.perTag;
  const longest = Math.max(...stats.lengths.map((b) => b.count));
  const commonest = stats.lengths.find((b) => b.count === longest);
  const [topPair] = stats.pairs;
  const neutral = hueOf('cobalt');
  return [
    // the totals, as big numbers
    h(
      'section',
      { class: 'story-section story-totals' },
      h('p', { class: 'story-label' }, '收錄'),
      h(
        'dl',
        { class: 'story-numbers' },
        [
          [stats.words, '詞'],
          [stats.tags, '標籤'],
          [stats.contributors, '貢獻者'],
          [stats.multiTag, '有兩个以上標籤的詞'],
        ].map(([value, label]) => h('div', { class: 'story-number' }, h('dt', {}, label), h('dd', { 'data-value': value }, number(value)))),
      ),
    ),
    section(
      '標籤',
      `${topTag.name}上濟，有 ${number(topTag.count)} 个詞。`,
      h(
        'ol',
        { class: 'story-bars' },
        stats.perTag.map((tag, index) =>
          bar({ label: tag.name, href: tagRoute(tag.name), share: tag.count / topTag.count, count: tag.count, color: hueOf(tag.hue), index }),
        ),
      ),
    ),
    section(
      '詞的長短',
      `${commonest.length} 字的詞上濟，有 ${number(commonest.count)} 个。`,
      h(
        'ol',
        { class: 'story-columns' },
        stats.lengths.map((b, index) =>
          h(
            'li',
            { class: 'story-column', style: `--share: ${b.count / longest}; --i: ${index}; --bar: ${neutral}` },
            h('span', { class: 'story-column-count' }, number(b.count)),
            h('span', { class: 'story-column-track' }, h('span', { class: 'story-column-fill' })),
            h('span', { class: 'story-column-label' }, b.orLonger ? `${b.length} 字以上` : `${b.length} 字`),
          ),
        ),
      ),
    ),
    topPair
      ? section(
          '做伙出現的標籤',
          `${topPair.tags[0]}佮${topPair.tags[1]}上濟做伙出現，有 ${number(topPair.count)} 个詞。`,
          h(
            'ol',
            { class: 'story-bars story-pairs' },
            stats.pairs.map((pair, index) =>
              h(
                'li',
                // the bar runs from one tag's colour to the other's
                {
                  class: 'story-bar',
                  style: `--share: ${pair.count / topPair.count}; --i: ${index}; --bar: ${hueOf(hueByTag.get(pair.tags[0]))}; --bar-end: ${hueOf(hueByTag.get(pair.tags[1]))}`,
                },
                h(
                  'span',
                  { class: 'story-bar-label' },
                  pair.tags.flatMap((name, i) => [
                    i > 0 ? ' · ' : null,
                    h('a', { href: tagRoute(name), style: `--dot: ${hueOf(hueByTag.get(name))}` }, name),
                  ]),
                ),
                h('span', { class: 'story-bar-track' }, h('span', { class: 'story-bar-fill' })),
                h('span', { class: 'story-bar-count' }, number(pair.count)),
              ),
            ),
          ),
        )
      : null,
    section(
      '貢獻者',
      `頭前 ${stats.topContributors.length} 位貢獻者，貢獻 ${percent(stats.topShare)} 的詞。`,
      h(
        'ol',
        { class: 'story-bars' },
        stats.topContributors.map((person, index) =>
          bar({
            label: person.name,
            href: contributorRoute(person.name),
            share: person.count / stats.topContributors[0].count,
            count: person.count,
            color: neutral,
            index,
          }),
        ),
      ),
      `有 ${number(stats.singleWordContributors)} 位貢獻 1 个詞。`,
    ),
  ].filter(Boolean);
}

// Each section is shown once it scrolls into view: its rise and its bars run on CSS transitions,
// its big numbers count up here.
function reveal(root) {
  const show = (target) => {
    target.classList.add('is-shown');
    for (const figure of target.querySelectorAll('dd[data-value]')) countUp(figure);
  };
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    for (const target of root.children) target.classList.add('is-shown');
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.2 },
  );
  for (const target of root.children) observer.observe(target);
}

// 0 → the figure's value, easing out, the final text exact.
function countUp(figure) {
  const target = Number(figure.dataset.value);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / COUNT_MS);
    figure.textContent = number(Math.round(target * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
