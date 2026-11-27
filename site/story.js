import { h } from './dom.js';
import { contributorRoute, tagRoute } from './logic.js';

// The homepage's statistics under the bubble map (dist/stats.json, from scripts/stats.js), told as
// a scrolling story after iNaturalist's Year in Review and Bloomberg's graphics: each section is a
// centred title over one chart, and rises into view when the reader scrolls to it, its bars growing
// and its big numbers counting up. Pointing at a bar or column (or tabbing to it, or tapping it)
// shows its figures in a tooltip and fades the rest of its chart. Readers who ask for reduced motion
// get it all at once.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// a big number's count-up
const COUNT_MS = 1400;

const number = (n) => n.toLocaleString('en-US');
const percent = (part, whole) => `${((100 * part) / whole).toFixed(1)}%`;
// each chart row's tooltip: { color, title, tl, value, lines }
const tips = new WeakMap();
const withTip = (row, tip) => {
  tips.set(row, tip);
  return row;
};

// loadStats() → stats.json; the sections arrive once it has loaded (nothing shows if it fails).
export function storySections(loadStats) {
  const root = h('div', { class: 'story' });
  loadStats()
    .then((stats) => {
      root.append(...sections(stats));
      reveal(root);
      hoverTips(root);
    })
    .catch(() => {});
  return root;
}

// One section: its title, centred, over its chart.
const section = (title, chart) => h('section', { class: 'story-section' }, h('h2', { class: 'story-title' }, title), chart);

// A ranked bar: its label (a link when `href`), a track filled to `share`, its count; `tip` its
// tooltip.
const bar = ({ label, href, share, count, color, index, tip }) =>
  withTip(
    h(
      'li',
      { class: 'story-bar', style: `--share: ${share}; --i: ${index}; --bar: ${color}` },
      href ? h('a', { class: 'story-bar-label', href }, label) : h('span', { class: 'story-bar-label' }, label),
      h('span', { class: 'story-bar-track' }, h('span', { class: 'story-bar-fill' })),
      h('span', { class: 'story-bar-count' }, number(count)),
    ),
    tip,
  );

function sections(stats) {
  const countByTag = new Map(stats.perTag.map((tag) => [tag.name, tag.count]));
  const [topTag] = stats.perTag;
  const longest = Math.max(...stats.lengths.map((b) => b.count));
  const [topPair] = stats.pairs;
  // BBC style: a single series is one blue (the tags, the lengths)
  const neutral = 'var(--hue-blue)';
  return [
    // the totals, as big numbers
    section(
      '收錄',
      h(
        'dl',
        { class: 'story-numbers' },
        [
          [stats.words, '詞'],
          [stats.tags, '標籤'],
          [stats.contributors, '貢獻者'],
          [stats.multiTag, '有兩个以上標籤 ê 詞'],
        ].map(([value, label]) => h('div', { class: 'story-number' }, h('dt', {}, label), h('dd', { 'data-value': value }, number(value)))),
      ),
    ),
    section(
      '標籤',
      h(
        'ol',
        { class: 'story-bars' },
        stats.perTag.map((tag, index) =>
          bar({
            label: tag.name,
            href: tagRoute(tag.name),
            share: tag.count / topTag.count,
            count: tag.count,
            color: neutral,
            index,
            tip: { color: neutral, title: tag.name, tl: tag.tl, value: `${number(tag.count)} 个詞`, lines: [`占全部 ê ${percent(tag.count, stats.words)}`, `排名第 ${index + 1}`] },
          }),
        ),
      ),
    ),
    section(
      '詞 ê 長短',
      h(
        'ol',
        { class: 'story-columns' },
        stats.lengths.map((b, index) =>
          withTip(
            h(
            'li',
            // no link inside, so the column itself takes Tab for its tooltip
            { class: 'story-column', tabindex: '0', style: `--share: ${b.count / longest}; --i: ${index}; --bar: ${neutral}` },
            h('span', { class: 'story-column-count' }, number(b.count)),
            h('span', { class: 'story-column-track' }, h('span', { class: 'story-column-fill' })),
            h('span', { class: 'story-column-label' }, b.orLonger ? `${b.length} 字以上` : `${b.length} 字`),
            ),
            { color: neutral, title: b.orLonger ? `${b.length} 字以上` : `${b.length} 字`, value: `${number(b.count)} 个詞`, lines: [`占全部 ê ${percent(b.count, stats.words)}`] },
          ),
        ),
      ),
    ),
    topPair
      ? section(
          '做伙出現 ê 標籤',
          h(
            'ol',
            { class: 'story-bars story-pairs' },
            stats.pairs.map((pair, index) =>
              withTip(
              h(
                'li',
                {
                  class: 'story-bar',
                  style: `--share: ${pair.count / topPair.count}; --i: ${index}; --bar: ${neutral}`,
                },
                h(
                  'span',
                  { class: 'story-bar-label' },
                  pair.tags.flatMap((name, i) => [
                    i > 0 ? ' · ' : null,
                    h('a', { href: tagRoute(name) }, name),
                  ]),
                ),
                h('span', { class: 'story-bar-track' }, h('span', { class: 'story-bar-fill' })),
                h('span', { class: 'story-bar-count' }, number(pair.count)),
              ),
              // each tag's share: how many of its words also carry the other
              {
                color: neutral,
                title: pair.tags.join(' · '),
                value: `${number(pair.count)} 个詞`,
                lines: pair.tags.map((name) => `占${name} ê ${percent(pair.count, countByTag.get(name))}`),
              },
              ),
            ),
          ),
        )
      : null,
    // the community's own contributors (GitHub accounts), most words first, by their GitHub picture
    stats.githubContributors.length > 0
      ? section(
          '社群貢獻者',
          h(
            'ol',
            { class: 'story-faces' },
            stats.githubContributors.map((person, index) =>
              h(
                'li',
                { style: `--i: ${index}` },
                h(
                  'a',
                  { class: 'story-face', href: contributorRoute(person.name), title: `${person.name} · ${number(person.count)} 个詞` },
                  h('img', { src: `https://avatars.githubusercontent.com/u/${person.id}?s=128`, alt: '', width: 64, height: 64, loading: 'lazy', decoding: 'async' }),
                  h('span', { class: 'story-face-name' }, person.name),
                ),
              ),
            ),
          ),
        )
      : null,
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

// One tooltip for the whole story, beside the pointer (or above a row reached by Tab), kept inside
// the window; the chart the row belongs to fades its other rows meanwhile. A tap shows it too.
function hoverTips(root) {
  const tip = h('div', { class: 'story-tip', 'aria-hidden': 'true' });
  document.body.append(tip);
  let current = null;
  // how the tooltip was opened: 'pointer' follows the mouse, 'focus' sits above the focused row
  let openedBy = null;
  const rowOf = (target) => {
    const row = target.closest?.('.story-bar, .story-column');
    return row && tips.has(row) ? row : null;
  };
  const place = (x, y) => {
    const gap = 14;
    const { offsetWidth: w, offsetHeight: hgt } = tip;
    const left = x + gap + w > window.innerWidth ? x - gap - w : x + gap;
    const top = Math.max(8, Math.min(window.innerHeight - hgt - 8, y - hgt / 2));
    tip.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
  };
  const show = (row) => {
    if (row === current) return;
    hide();
    current = row;
    const { color, title, tl, value, lines } = tips.get(row);
    tip.replaceChildren(
      h('p', { class: 'story-tip-title', style: `--swatch: ${color}` }, title, tl ? h('span', { class: 'story-tip-tl tl' }, tl) : null),
      h('p', { class: 'story-tip-value' }, value),
      ...lines.map((line) => h('p', { class: 'story-tip-line' }, line)),
    );
    tip.classList.add('is-visible');
    row.classList.add('is-hover');
    row.parentElement.classList.add('has-hover');
  };
  const hide = () => {
    if (!current) return;
    tip.classList.remove('is-visible');
    current.classList.remove('is-hover');
    current.parentElement.classList.remove('has-hover');
    current = null;
  };
  const placeAbove = (row) => {
    const box = row.getBoundingClientRect();
    place(box.left + box.width / 2, box.top);
  };
  root.addEventListener('pointermove', (event) => {
    const row = rowOf(event.target);
    if (!row) return hide();
    show(row);
    openedBy = 'pointer';
    place(event.clientX, event.clientY);
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', (event) => {
    const row = rowOf(event.target);
    if (!row) return;
    show(row);
    openedBy = 'focus';
    placeAbove(row);
  });
  root.addEventListener('focusout', hide);
  // the page moving under a still pointer would leave the tooltip on the wrong row; a focused row's
  // tooltip (Tab scrolls the row into view) moves with it instead
  const onScroll = () => (openedBy === 'focus' && current ? placeAbove(current) : hide());
  window.addEventListener('scroll', onScroll, { passive: true });
  // the homepage is rebuilt on every visit: the tooltip leaves with its story
  new MutationObserver((_, observer) => {
    if (root.isConnected) return;
    tip.remove();
    window.removeEventListener('scroll', onScroll);
    observer.disconnect();
  }).observe(document.getElementById('view'), { childList: true });
}
