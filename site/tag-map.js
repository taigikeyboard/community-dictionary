import { h, svg } from './dom.js';
import { icon } from './icons.js';
import { tagCircles, tagRoute, wordRoute } from './logic.js';

// The homepage's tag bubbles, drawn with D3: one circle per site tag, its area following how many
// words carry the tag, the tag's sample words packed inside it as small bubbles (d3-hierarchy). The
// circles are bodies in a d3-force simulation: hovering one swells it and it shoulders its
// neighbours aside, which jostle and settle; leaving it lets them drift back. Clicking a tag (or
// Enter / Space on it) zooms in until it fills the box, and its words can be read and opened; a
// click outside it, Escape or 全部標籤 zooms back out (d3-interpolate's interpolateZoom). Readers
// who ask for reduced motion get the same map without the movement. The box keeps its size
// (styles.css), so nothing around it moves.

// loaded on the first draw, so other pages never fetch them; index.html's import map names them
let d3Loading = null;
const loadD3 = () =>
  (d3Loading ??= Promise.all(['d3-ease', 'd3-force', 'd3-hierarchy', 'd3-interpolate', 'd3-timer'].map((name) => import(name)))
    .then((modules) => Object.assign({}, ...modules))
    .catch((error) => {
      d3Loading = null;
      throw error;
    }));

// words per tag shown zoomed in (tag-map.json holds more): fewer on a narrow screen, so each
// bubble, and its Tâi-lô, stays large enough to read
const WIDE_WORDS = 32;
const PHONE_WORDS = 24;
// how much a hovered tag swells
const HOVER_GROWTH = 1.25;
// px between circles
const GAP = 6;

// a word bubble's Tâi-lô line, against its Hanji line
const TL_SCALE = 0.62;
const firstReading = (tl) => tl.split('/')[0];
// a word's width in its Hanji's em: the Hanji (1em a character) or the Tâi-lô under it (about
// half an em a letter, at TL_SCALE), whichever is wider, at least 2
const wordWidth = ([hanji, tl]) => Math.max(2, [...hanji].length, 0.52 * TL_SCALE * [...firstReading(tl).normalize('NFC')].length);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// loadTags() → tag-map.json entries; fallback() → what the box shows if the map cannot load.
export function tagMap(loadTags, fallback) {
  const box = h('div', { class: 'tag-map' });
  const back = h('button', { class: 'tag-map-back', type: 'button' }, icon('back'), '全部標籤');
  const more = h('a', { class: 'tag-map-more' });
  // the bar under the map keeps its height while empty, so zooming never moves the page
  const bar = h('div', { class: 'tag-map-bar', 'data-empty': 'true' }, back, more);
  const section = h('div', { class: 'tag-map-section' }, box, bar);
  Promise.all([loadTags(), loadD3()])
    .then(([tags, d3]) => {
      let drawn = '';
      let current = null;
      const observer = new ResizeObserver(() => {
        if (!section.isConnected) {
          current?.stop();
          return observer.disconnect();
        }
        const { width, height } = box.getBoundingClientRect();
        if (width === 0 || height === 0 || `${width}x${height}` === drawn) return;
        drawn = `${width}x${height}`;
        current?.stop();
        current = draw(d3, tags, box, bar, more, width, height);
      });
      observer.observe(box);
      back.addEventListener('click', () => current?.zoomOut({ refocus: true }));
      section.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') current?.zoomOut({ refocus: true });
      });
    })
    .catch(() => box.replaceChildren(fallback()));
  return section;
}

// Draws the map for a width × height box and sets it moving; returns { zoomOut, stop }.
function draw(d3, tags, box, bar, more, width, height) {
  const aspect = width / height;
  const wordCount = width < 600 ? PHONE_WORDS : WIDE_WORDS;
  // start from a tight pack, then let the forces settle it before the first paint
  const { circles } = tagCircles(
    tags.map((tag) => tag.count),
    width,
    height,
    { gap: GAP },
  );
  const nodes = circles.map(({ r, x, y }, index) => ({ index, r, x, y, grow: 1, scale: 1 }));
  // forceCollide reads the radii once; swell() hands it the accessor again after a size changes
  const reach = (node) => node.r * node.grow + GAP;
  const collide = d3.forceCollide(reach).strength(0.8).iterations(2);
  const simulation = d3
    .forceSimulation(nodes)
    // held towards the centre, more loosely sideways, so the cluster takes the box's shape
    .force('x', d3.forceX(0).strength(0.05 / aspect))
    .force('y', d3.forceY(0).strength(0.05 * aspect))
    .force('collide', collide)
    .alphaDecay(0.04)
    .stop();
  for (let i = 0; i < 300; i += 1) simulation.tick();

  const settled = {
    left: Math.min(...nodes.map((n) => n.x - n.r)),
    top: Math.min(...nodes.map((n) => n.y - n.r)),
    right: Math.max(...nodes.map((n) => n.x + n.r)),
    bottom: Math.max(...nodes.map((n) => n.y + n.r)),
  };
  // a view is [centre x, centre y, width], as d3.interpolateZoom takes it; the root view leaves
  // room for a swollen circle at the edge
  const rootView = [(settled.left + settled.right) / 2, (settled.top + settled.bottom) / 2, 1.12 * Math.max(settled.right - settled.left, (settled.bottom - settled.top) * aspect)];
  const tagView = (node) => [node.x, node.y, 2.04 * node.r * Math.max(1, aspect)];
  const map = svg('svg', { class: 'tag-map-svg' });
  const show = ([x, y, w]) => map.setAttribute('viewBox', `${x - w / 2} ${y - w / aspect / 2} ${w} ${w / aspect}`);

  // each tag drawn around (0, 0); the simulation moves the group and scales its body
  const bubbles = tags.map((tag, i) => {
    const { r } = nodes[i];
    // the words fill a circle a little inside the tag's, each bubble holding the Hanji over its
    // Tâi-lô (the first reading of several); a bubble's radius follows the wider of the two lines
    // (area by width squared), so every word is set at the same size
    const inner = r * 0.9;
    const pack = d3
      .pack()
      .size([2 * inner, 2 * inner])
      .padding(inner * 0.02)(d3.hierarchy({ children: tag.words.slice(0, wordCount) }).sum((d) => (Array.isArray(d) ? wordWidth(d) ** 2 : 0)));
    const words = (pack.children ?? []).map((node) => {
      const [hanji, tl] = node.data;
      const cx = node.x - inner;
      const cy = node.y - inner;
      const size = Math.min(0.62 * node.r, (1.45 * node.r) / wordWidth(node.data));
      return svg(
        'a',
        { class: 'word-bubble', href: wordRoute(hanji, tl), tabindex: '-1', 'aria-label': `${hanji} ${tl}` },
        svg('circle', { cx, cy, r: node.r }),
        svg('text', { class: 'word-hanji', x: cx, y: cy - 0.32 * size, 'font-size': size }, hanji),
        svg('text', { class: 'word-tl', x: cx, y: cy + 0.55 * size, 'font-size': TL_SCALE * size }, firstReading(tl)),
      );
    });
    const target = svg(
      'circle',
      { class: 'tag-circle', r, role: 'button', tabindex: '0', 'aria-label': tag.name },
      svg('title', {}, tag.tl ? `${tag.name} ${tag.tl}` : tag.name),
    );
    // the name with its Tâi-lô under it
    const nameSize = Math.min(24, Math.max(13, r * 0.3));
    const name = svg(
      'g',
      { class: 'tag-name', 'aria-hidden': 'true' },
      // 0.3em above the centre, back on it when the 台羅 switch is off (styles.css)
      svg('text', { class: 'tag-hanji', y: -0.3 * nameSize, 'font-size': nameSize }, tag.name),
      svg('text', { class: 'tag-tl', y: 0.62 * nameSize, 'font-size': 0.55 * nameSize }, tag.tl),
    );
    const body = svg('g', { class: 'tag-body' }, target, svg('g', { class: 'tag-words' }, words), name);
    return { tag, node: nodes[i], target, words, body, group: svg('g', { class: 'tag-bubble', 'data-hue': tag.hue }, body) };
  });
  map.append(...bubbles.map((b) => b.group));
  box.replaceChildren(map);

  // each tick: ease every body towards its target size, then place it
  const place = () => {
    for (const { node, group, body } of bubbles) {
      node.scale += (node.grow - node.scale) * 0.25;
      group.setAttribute('transform', `translate(${node.x} ${node.y})`);
      body.setAttribute('transform', `scale(${node.scale})`);
    }
  };
  simulation.on('tick', place);
  place();

  let view = rootView;
  let zoomTimer = null;
  let focused = null;
  const swell = (index, grow) => {
    if (focused !== null || reducedMotion.matches) return;
    nodes[index].grow = grow;
    collide.radius(reach);
    simulation.alpha(Math.max(simulation.alpha(), 0.5)).restart();
  };
  const zoom = (target) => {
    zoomTimer?.stop();
    const path = d3.interpolateZoom(view, target);
    if (reducedMotion.matches) {
      view = target;
      return show(view);
    }
    const duration = Math.min(900, Math.max(450, path.duration));
    zoomTimer = d3.timer((elapsed) => {
      const t = Math.min(1, elapsed / duration);
      view = path(d3.easeCubicInOut(t));
      show(view);
      if (t === 1) zoomTimer.stop();
    });
  };
  // marks the focused tag (or none): its words take clicks and Tab, the others dim, the bar fills;
  // the bodies hold still while zoomed in
  const focus = (index) => {
    focused = index;
    map.classList.toggle('zoomed', index !== null);
    bubbles.forEach((b, i) => {
      b.group.classList.toggle('focused', i === index);
      for (const word of b.words) word.setAttribute('tabindex', i === index ? '0' : '-1');
    });
    bar.dataset.empty = String(index === null);
    if (index !== null) {
      const { name } = bubbles[index].tag;
      more.href = tagRoute(name);
      more.replaceChildren(`看「${name}」全部`, icon('chevron'));
    }
  };
  const zoomIn = (index) => {
    for (const node of nodes) node.grow = 1;
    collide.radius(reach);
    simulation.stop();
    place();
    focus(index);
    zoom(tagView(nodes[index]));
  };
  const zoomOut = ({ refocus = false } = {}) => {
    if (focused === null) return;
    const was = bubbles[focused].target;
    focus(null);
    zoom(rootView);
    if (refocus) was.focus({ preventScroll: true });
  };
  bubbles.forEach((b, i) => {
    b.group.addEventListener('pointerenter', () => swell(i, HOVER_GROWTH));
    b.group.addEventListener('pointerleave', () => swell(i, 1));
    b.target.addEventListener('click', () => focused !== i && zoomIn(i));
    b.target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (focused !== i) zoomIn(i);
    });
  });
  // a click on the empty space around the circles zooms out
  map.addEventListener('click', (event) => {
    if (event.target === map) zoomOut();
  });
  show(view);
  bar.dataset.empty = 'true';
  return {
    zoomOut,
    stop: () => {
      simulation.stop();
      zoomTimer?.stop();
    },
  };
}
