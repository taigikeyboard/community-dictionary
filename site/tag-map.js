import { h, svg } from './dom.js';
import { icon } from './icons.js';
import { tagCircles, tagRoute, wordRoute } from './logic.js';

// The homepage's tag bubbles, drawn with D3: one circle per site tag, its area following how many
// words carry the tag, the tag's sample words packed inside it as small bubbles (d3-hierarchy). The
// circles are bodies in a d3-force simulation: hovering one swells it and it shoulders its
// neighbours aside, which jostle and settle; leaving it lets them drift back. Clicking a tag (or
// Enter / Space on it) zooms in until it fills the box, and its words can be read and opened; a
// click outside it, Escape or 全部標籤 zooms back out (d3-interpolate's interpolateZoom). Each time
// the homepage opens, the bubbles enter: drawn in towards the centre and unseen, they ease out to
// their places, swelling into view one after another, largest first. Readers who ask for reduced motion
// get the same map without the movement. The box keeps its size
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

// words per tag shown zoomed in, drawn from tag-map.json's larger pool: fewer on a narrow screen, so each
// bubble, and its Tâi-lô, stays large enough to read
const WIDE_WORDS = 32;
const PHONE_WORDS = 24;
// how much a hovered tag swells
const HOVER_GROWTH = 1.25;
// the share of the way to its hover size a bubble covers each frame: lower is a slower, softer swell
const HOVER_EASE = 0.18;
// the entrance: how drawn in the bubbles start (share of their final distance from the centre; near
// 1, so the forces ease them out instead of flinging them), the time over which they start to
// appear (centre first, the gaps widening outwards) and how long each takes to spring open
const ENTRANCE_SPREAD = 0.85;
const ENTRANCE_SPAN_MS = 1500;
const ENTRANCE_POP_MS = 700;
// a little randomness in each start, so the bloom does not tick like a metronome
const ENTRANCE_JITTER_MS = 80;
// a zoom in or out
const ZOOM_MS = 650;
// how far the mouse moves (px) before a press becomes a drag rather than a click
const DRAG_THRESHOLD_PX = 4;
// px between circles
const GAP = 6;

// a word bubble's Tâi-lô line, against its Hanji line
const TL_SCALE = 0.62;
const firstReading = (tl) => tl.split('/')[0];
// a word's width in its Hanji's em: the Hanji (1em a character) or the Tâi-lô under it (about
// half an em a letter, at TL_SCALE), whichever is wider, at least 2
const wordWidth = ([hanji, tl]) => Math.max(2, [...hanji].length, 0.52 * TL_SCALE * [...firstReading(tl).normalize('NFC')].length);

// up to `count` of `pool`, a fresh random draw each call (a partial Fisher-Yates shuffle)
function randomSample(pool, count) {
  const items = [...pool];
  const size = Math.min(count, items.length);
  for (let i = 0; i < size; i += 1) {
    const j = i + Math.floor(Math.random() * (items.length - i));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, size);
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// loadTags() → tag-map.json entries; fallback() → what the box shows if the map cannot load;
// onWord({ hanji, tl }, link) runs when a word bubble is clicked (instead of following its link);
// onZoomIn() when a tag is zoomed into (a page can start loading what a word click will need).
export function tagMap(loadTags, fallback, { onWord = null, onZoomIn = () => {} } = {}) {
  const box = h('div', { class: 'tag-map' });
  const back = h('button', { class: 'tag-map-back', type: 'button' }, icon('back'), '全部標籤');
  // the zoomed tag's page, with every word the bubble only samples (draw() fills it in)
  const all = h('a', { class: 'tag-map-all' });
  // the bar under the map keeps its height while empty, so zooming never moves the page
  const bar = h('div', { class: 'tag-map-bar', 'data-empty': 'true' }, back, all);
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
        // the entrance plays on the first draw only, not when a resize redraws the map
        current = draw(d3, tags, box, bar, all, width, height, { entrance: current === null, onWord, onZoomIn });
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

// Draws the map for a width × height box and sets it moving (with the entrance when `entrance`);
// `all` is the bar's link to the zoomed tag's page. Returns { zoomOut, stop }.
function draw(d3, tags, box, bar, all, width, height, { entrance = false, onWord = null, onZoomIn = () => {} } = {}) {
  const aspect = width / height;
  const wordCount = width < 600 ? PHONE_WORDS : WIDE_WORDS;
  // start from a tight pack, then let the forces settle it before the first paint
  const { circles } = tagCircles(
    tags.map((tag) => tag.count),
    width,
    height,
    { gap: GAP },
  );
  // scale: eased towards grow (hover); entry: the entrance's own factor (1 once it is in)
  const nodes = circles.map(({ r, x, y }, index) => ({ index, r, x, y, grow: 1, scale: 1, entry: 1 }));
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
    // stop well before the default 0.001 and damp harder: settle crisply instead of drifting
    .alphaMin(0.02)
    .velocityDecay(0.5)
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
  // one gradient for every shadow: solid until just under the circle's edge, clear at its own rim
  const shadowGradient = svg(
    'radialGradient',
    { id: 'bubble-shadow' },
    svg('stop', { class: 'bubble-shadow-solid', offset: '0.84' }),
    svg('stop', { class: 'bubble-shadow-clear', offset: '1' }),
  );
  const map = svg('svg', { class: 'tag-map-svg' }, svg('defs', {}, shadowGradient));
  // The viewBox is set once, to the root view; every other view (a zoom, a pan) is drawn as a CSS
  // transform of the whole <svg>. A viewBox change re-lays out all ~5,800 SVG nodes (a visible hitch);
  // a transform only redraws them, and the browser re-renders the still layer sharp at its scale.
  map.setAttribute('viewBox', `${rootView[0] - rootView[2] / 2} ${rootView[1] - rootView[2] / aspect / 2} ${rootView[2]} ${rootView[2] / aspect}`);
  const show = ([x, y, w]) => {
    const k = rootView[2] / w;
    const cx = ((x - rootView[0]) * width) / rootView[2] + width / 2;
    const cy = ((y - rootView[1]) * width) / rootView[2] + height / 2;
    map.style.transform = `translate(${width / 2 - k * cx}px, ${height / 2 - k * cy}px) scale(${k})`;
  };

  // the words fill a circle a little inside the tag's (radius r), each bubble holding the Hanji over
  // its Tâi-lô (the first reading of several); a bubble's radius follows the wider of the two lines
  // (area by width squared), so every word is set at the same size
  const packWords = (r, sample) => {
    const inner = r * 0.9;
    const pack = d3
      .pack()
      .size([2 * inner, 2 * inner])
      .padding(inner * 0.02)(d3.hierarchy({ children: sample }).sum((d) => (Array.isArray(d) ? wordWidth(d) ** 2 : 0)));
    return (pack.children ?? []).map((node) => {
      const [hanji, tl] = node.data;
      const cx = node.x - inner;
      const cy = node.y - inner;
      const size = Math.min(0.62 * node.r, (1.45 * node.r) / wordWidth(node.data));
      const link = svg(
        'a',
        { class: 'word-bubble', href: wordRoute(hanji, tl), tabindex: '-1', 'aria-label': `${hanji} ${tl}`, 'aria-haspopup': onWord ? 'dialog' : null },
        svg('circle', { cx, cy, r: node.r }),
        svg('text', { class: 'word-hanji', x: cx, y: cy - 0.32 * size, 'font-size': size }, hanji),
        svg('text', { class: 'word-tl', x: cx, y: cy + 0.55 * size, 'font-size': TL_SCALE * size }, firstReading(tl)),
      );
      // a plain click (or Enter) opens the word's card in place; a modified click still follows the link
      link.addEventListener('click', (event) => {
        if (!onWord || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onWord({ hanji, tl }, link);
      });
      return link;
    });
  };

  // each tag drawn around (0, 0); the simulation moves the group and scales its body. Its words start
  // as the pool's first few, the same on every visit (unzoomed they are only a tint); each zoom into
  // the tag repacks a fresh random draw (zoomIn)
  const bubbles = tags.map((tag, i) => {
    const { r } = nodes[i];
    const words = packWords(r, tag.words.slice(0, wordCount));
    const wordLayer = svg('g', { class: 'tag-words' }, words);
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
    // the shadow reaches 12% past the circle and sits a little low, as light from above would cast it
    const shadow = svg('circle', { class: 'tag-shadow', cy: r * 0.04, r: r * 1.12, fill: 'url(#bubble-shadow)' });
    const body = svg('g', { class: 'tag-body' }, shadow, target, wordLayer, name);
    return { tag, node: nodes[i], target, words, wordLayer, body, group: svg('g', { class: 'tag-bubble' }, body) };
  });
  map.append(...bubbles.map((b) => b.group));
  box.replaceChildren(map);

  // each tick: ease every body towards its hover size, then place it at that size times its
  // entrance factor
  const place = () => {
    for (const { node, group, body } of bubbles) {
      node.scale += (node.grow - node.scale) * HOVER_EASE;
      group.setAttribute('transform', `translate(${node.x} ${node.y})`);
      body.setAttribute('transform', `scale(${node.scale * node.entry})`);
    }
  };
  simulation.on('tick', place);
  // the entrance runs on its own timer (the simulation may cool before the last bubble is due):
  // bubbles bloom from the centre outwards, each springing open past its size and settling back,
  // while a gentle reheat eases them out from slightly drawn in
  let entranceTimer = null;
  if (entrance && !reducedMotion.matches) {
    const order = [...nodes].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    order.forEach((node, rank) => {
      const share = rank / Math.max(1, order.length - 1);
      node.delay = ENTRANCE_SPAN_MS * share ** 1.3 + (Math.random() - 0.5) * ENTRANCE_JITTER_MS;
      node.entry = 0;
      node.x *= ENTRANCE_SPREAD;
      node.y *= ENTRANCE_SPREAD;
    });
    const pop = d3.easeBackOut.overshoot(1.4);
    entranceTimer = d3.timer((elapsed) => {
      let done = true;
      for (const node of nodes) {
        const progress = Math.min(1, Math.max(0, (elapsed - node.delay) / ENTRANCE_POP_MS));
        node.entry = progress === 0 ? 0 : pop(progress);
        if (progress < 1) done = false;
      }
      place();
      if (done) entranceTimer.stop();
    });
    simulation.alpha(0.3).restart();
  }
  place();

  let view = rootView;
  let zoomTimer = null;
  let focused = null;
  let drag = null;
  const swell = (index, grow) => {
    if (focused !== null || drag?.start || reducedMotion.matches) return;
    nodes[index].grow = grow;
    collide.radius(reach);
    simulation.alpha(Math.max(simulation.alpha(), 0.5)).restart();
  };
  const zoom = (target) => {
    zoomTimer?.stop();
    const path = d3.interpolateZoom(view, target);
    if (reducedMotion.matches) {
      view = target;
      map.classList.remove('moving');
      return show(view);
    }
    map.classList.add('moving');
    zoomTimer = d3.timer((elapsed) => {
      const t = Math.min(1, elapsed / ZOOM_MS);
      view = path(d3.easeCubicInOut(t));
      show(view);
      if (t === 1) {
        zoomTimer.stop();
        map.classList.remove('moving');
      }
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
      const { tag } = bubbles[index];
      all.href = tagRoute(tag.name);
      all.textContent = `看全部 ${tag.count.toLocaleString('en-US')} 个詞 →`;
    }
  };
  const zoomIn = (index) => {
    onZoomIn();
    const b = bubbles[index];
    b.words = packWords(b.node.r, randomSample(b.tag.words, wordCount));
    b.wordLayer.replaceChildren(...b.words);
    // the bodies hold still while zoomed in, so a hover swell is undone at once, not eased (with
    // the simulation stopped, no later tick would finish easing it)
    for (const node of nodes) {
      node.grow = 1;
      node.scale = 1;
    }
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

  // dragging with the mouse pans the view (touch keeps scrolling the page), the centre kept within
  // the map; the click that ends a drag is swallowed before any bubble sees it
  const reachX = rootView[2] / 2;
  const reachY = rootView[2] / aspect / 2;
  const keepInside = ([x, y, w]) => [
    Math.min(rootView[0] + reachX, Math.max(rootView[0] - reachX, x)),
    Math.min(rootView[1] + reachY, Math.max(rootView[1] - reachY, y)),
    w,
  ];
  let dragged = false;
  map.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId, start: null };
  });
  map.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.start) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // a zoom still under way stops where it is
      zoomTimer?.stop();
      map.classList.remove('moving');
      drag.start = view;
      map.setPointerCapture(drag.id);
      map.classList.add('panning');
    }
    const perPx = drag.start[2] / width;
    view = keepInside([drag.start[0] - dx * perPx, drag.start[1] - dy * perPx, drag.start[2]]);
    show(view);
  });
  const endDrag = () => {
    if (drag?.start) {
      map.classList.remove('panning');
      dragged = true;
      // the click (if any) follows in this same task; after it, clicks count again
      setTimeout(() => {
        dragged = false;
      });
    }
    drag = null;
  };
  map.addEventListener('pointerup', endDrag);
  map.addEventListener('pointercancel', endDrag);
  map.addEventListener(
    'click',
    (event) => {
      if (!dragged) return;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
  show(view);
  bar.dataset.empty = 'true';
  return {
    zoomOut,
    stop: () => {
      simulation.stop();
      zoomTimer?.stop();
      entranceTimer?.stop();
    },
  };
}
