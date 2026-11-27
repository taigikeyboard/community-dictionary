import { h, svg } from './dom.js';
import { icon } from './icons.js';
import { tagCircles, tagRoute, wordRoute } from './logic.js';
import { formatNumber, t, tagLabel } from './strings.js';

// The homepage's tag bubbles, drawn with D3: one circle per site tag, its area following how many
// words carry the tag, the tag's word pool packed inside it as small bubbles (d3-hierarchy), the
// first words largest. The circles are bodies in a d3-force simulation: hovering one swells it and
// it shoulders its neighbours aside, which jostle and settle. The reader zooms freely (pinch,
// Ctrl + wheel, the ＋ / − buttons) or clicks a tag to zoom until it fills the box; as a word bubble
// grows large enough to read on screen, its word fades in, so zooming deeper brings more words out.
// Escape, a click on the empty space or 全部標籤 zooms back out. Each time the homepage opens, the
// bubbles enter: drawn in towards the centre and unseen, they ease out to their places, swelling
// into view one after another. Readers who ask for reduced motion get the same map without the
// movement. The box keeps its size (styles.css), so nothing around it moves.

// loaded on the first draw, so other pages never fetch them; index.html's import map names them
let d3Loading = null;
const loadD3 = () =>
  (d3Loading ??= Promise.all(['d3-ease', 'd3-force', 'd3-hierarchy', 'd3-interpolate', 'd3-timer'].map((name) => import(name)))
    .then((modules) => Object.assign({}, ...modules))
    .catch((error) => {
      d3Loading = null;
      throw error;
    }));

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
// an animated zoom (a click on a tag, the buttons, zooming out)
const ZOOM_MS = 650;
// how far the mouse moves (px) before a press becomes a drag rather than a click
const DRAG_THRESHOLD_PX = 4;
// px between circles
const GAP = 6;

// Level of detail. A word's text shows once its Hanji would be READ_PX tall on screen; a tag counts
// as open (its name gives way to its words, which take clicks) once its circle is OPEN_PX across
// the radius; the deepest zoom brings the smallest word to DEEPEST_PX. Words of a tag far
// off screen hide their text again, so only the words in view are laid out.
const READ_PX = 9;
const OPEN_PX = 150;
const DEEPEST_PX = 15;
// the view is checked this long after it last moved, not on every frame of a pinch
const DETAIL_DELAY_MS = 100;
// how long after the view last moved it is painted sharp again (makeCamera)
const SETTLE_MS = 150;
// word links built per detail pass
const REVEAL_BATCH = 40;
// below this zoom the map counts as zoomed out (hover swells, no 全部標籤)
const ZOOMED_AT = 1.05;
// the first words of a tag's pool are packed largest: a word's area weight falls from 1 + RANK_BOOST
// towards 1 over about RANK_FALLOFF words, so each step deeper brings a ring of smaller ones out
const RANK_BOOST = 10;
const RANK_FALLOFF = 14;
// one wheel notch (deltaY 100) zooms by e^(100 × WHEEL_RATE); the buttons by BUTTON_FACTOR
const WHEEL_RATE = 0.01;
const BUTTON_FACTOR = 2;

// a word bubble's Tâi-lô line, against its Hanji line
const TL_SCALE = 0.62;
const firstReading = (tl) => tl.split('/')[0];
// A word's width in its Hanji's em (1em a character, at least 2): it sizes the bubble and the
// Hanji, so a bubble's text grows with the bubble. The Tâi-lô line (about half an em a letter)
// shrinks below TL_SCALE when it would be wider than the Hanji.
const wordWidth = ([hanji]) => Math.max(2, [...hanji].length);
const tlLetters = (tl) => [...firstReading(tl).normalize('NFC')].length;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// loadTags() → tag-map.json entries; fallback() → what the box shows if the map cannot load;
// onWord({ hanji, tl }, link) runs when a word bubble is clicked (instead of following its link);
// onZoomIn() when the map is first zoomed in (a page can start loading what a word click will need).
export function tagMap(loadTags, fallback, { onWord = null, onZoomIn = () => {} } = {}) {
  const box = h('div', { class: 'tag-map' });
  const back = h('button', { class: 'tag-map-back', type: 'button' }, icon('back'), t('map.allTags'));
  // the open tag's page, with every word of the tag (draw() fills it in)
  const all = h('a', { class: 'tag-map-all' });
  // the bar under the map keeps its height while empty, so zooming never moves the page
  const bar = h('div', { class: 'tag-map-bar', 'data-empty': 'true' }, back, all);
  const zoomIn = h('button', { class: 'tag-map-zoom-button', type: 'button', 'aria-label': t('map.zoomIn'), title: t('map.zoomIn') }, icon('plus'));
  const zoomOut = h('button', { class: 'tag-map-zoom-button', type: 'button', 'aria-label': t('map.zoomOut'), title: t('map.zoomOut') }, icon('minus'));
  const buttons = h('div', { class: 'tag-map-zoom' }, zoomIn, zoomOut);
  const section = h('div', { class: 'tag-map-section' }, box, buttons, bar);
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
        current = draw({ d3, tags, box, bar, all, width, height, entrance: current === null, onWord, onZoomIn });
      });
      observer.observe(box);
      back.addEventListener('click', () => current?.zoomOut({ refocus: true }));
      zoomIn.addEventListener('click', () => current?.zoomBy(BUTTON_FACTOR));
      zoomOut.addEventListener('click', () => current?.zoomBy(1 / BUTTON_FACTOR));
      section.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') current?.zoomOut({ refocus: true });
      });
    })
    .catch(() => box.replaceChildren(fallback()));
  return section;
}

// Draws the map for a width × height box and sets it moving (with the entrance when `entrance`);
// `bar` is the bar under the box and `all` its link to the open tag's page. Returns
// { zoomOut, zoomBy, stop }.
function draw({ d3, tags, box, bar, all, width, height, entrance = false, onWord = null, onZoomIn = () => {} }) {
  const aspect = width / height;
  const { nodes, reach, collide, simulation, rootView } = settle(d3, tags, width, height, aspect);
  const { map, bubbles, deepest, reveal } = buildMap({ d3, tags, nodes, rootView, aspect, onWord });
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
  const entranceTimer = entrance && !reducedMotion.matches ? playEntrance(d3, nodes, simulation, place) : null;
  place();

  // the deepest zoom brings the smallest word to DEEPEST_PX on screen
  const unitPx = width / rootView[2];
  const minWidth = rootView[2] / Math.max(1, DEEPEST_PX / (deepest * unitPx));
  const camera = makeCamera(d3, map, rootView, width, height, minWidth);
  const detail = detailControls({ map, bar, all, bubbles, camera, width, height, onZoomIn, reveal });
  camera.onChange(detail.schedule);
  const zoom = zoomControls({ map, bubbles, nodes, reach, collide, simulation, place, aspect, rootView, camera });
  const pan = panControls({ map, camera, width });
  gestureControls({ map, camera, width, height });

  // hovering a tag swells it and the forces push its neighbours aside, unless the map is zoomed in
  // or being dragged
  const swell = (index, grow) => {
    if (camera.zoomLevel() > ZOOMED_AT || pan.isDragging() || reducedMotion.matches) return;
    nodes[index].grow = grow;
    collide.radius(reach);
    simulation.alpha(Math.max(simulation.alpha(), 0.5)).restart();
  };
  bubbles.forEach((b, i) => {
    b.group.addEventListener('pointerenter', () => swell(i, HOVER_GROWTH));
    b.group.addEventListener('pointerleave', () => swell(i, 1));
  });

  camera.moveTo(rootView);
  return {
    zoomOut: zoom.zoomOut,
    zoomBy: (factor) => camera.zoomTo(camera.scaled(factor)),
    stop: () => {
      simulation.stop();
      camera.stop();
      detail.stop();
      entranceTimer?.stop();
    },
  };
}

// The tags' circles for a width × height box: a tight pack (logic.js tagCircles) that the forces
// settle before the first paint, the simulation (stopped) that later moves them, and the root view
// around them.
function settle(d3, tags, width, height, aspect) {
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
  return { nodes, reach, collide, simulation, rootView };

}

// The <svg>: one bubble per tag, drawn around (0, 0) and placed by the simulation, each holding its
// shadow, its circle, its words and its name. Every word of a tag's pool is packed at once, but
// drawn as a bare circle (a tint) until detailControls reveals it; `deepest` is the smallest word
// size in svg units, which sets how far the map zooms in; `reveal(word)` turns a dot into its link.
function buildMap({ d3, tags, nodes, rootView, aspect, onWord }) {
  // one gradient for every shadow: solid until just under the circle's edge, clear at its own rim
  const shadowGradient = svg(
    'radialGradient',
    { id: 'bubble-shadow' },
    svg('stop', { class: 'bubble-shadow-solid', offset: '0.84' }),
    svg('stop', { class: 'bubble-shadow-clear', offset: '1' }),
  );
  const map = svg('svg', { class: 'tag-map-svg' }, svg('defs', {}, shadowGradient));
  // The viewBox is set once, to the root view; every other view (a zoom, a pan) is drawn as a CSS
  // transform of the whole <svg> (makeCamera). A viewBox change re-lays out every SVG node (a
  // visible hitch); a transform only redraws them.
  map.setAttribute('viewBox', `${rootView[0] - rootView[2] / 2} ${rootView[1] - rootView[2] / aspect / 2} ${rootView[2]} ${rootView[2] / aspect}`);

  // the pool fills a circle a little inside the tag's (radius r); a bubble's area follows the
  // wider of its two lines (width squared), weighted up for the first words, so every word in one
  // bubble is set to fit and the first ones are largest
  const packWords = (r, pool) => {
    const inner = r * 0.9;
    const weighted = pool.map((pair, rank) => ({ pair, weight: wordWidth(pair) ** 2 * (1 + RANK_BOOST * Math.exp(-rank / RANK_FALLOFF)) }));
    const pack = d3
      .pack()
      .size([2 * inner, 2 * inner])
      .padding(inner * 0.012)(d3.hierarchy({ children: weighted }).sum((d) => d.weight ?? 0));
    return (pack.children ?? []).map((node) => {
      const cx = node.x - inner;
      const cy = node.y - inner;
      const size = Math.min(0.62 * node.r, (1.45 * node.r) / wordWidth(node.data.pair));
      const tlSize = Math.min(TL_SCALE * size, (1.6 * node.r) / (0.52 * tlLetters(node.data.pair[1])));
      return { pair: node.data.pair, cx, cy, size, tlSize, link: null, dot: svg('circle', { class: 'word-dot', cx, cy, r: node.r }) };
    });
  };

  // a word's dot becomes a link with its Hanji over its Tâi-lô (the first reading of several), the
  // first time it is revealed
  const reveal = (word) => {
    const [hanji, tl] = word.pair;
    const { cx, cy, size, tlSize } = word;
    const link = svg(
      'a',
      { class: 'word-bubble', href: wordRoute(hanji, tl), tabindex: '-1', 'aria-label': `${hanji} ${tl}`, 'aria-haspopup': onWord ? 'dialog' : null },
      svg('text', { class: 'word-hanji', x: cx, y: cy - 0.32 * size, 'font-size': size }, hanji),
      svg('text', { class: 'word-tl', x: cx, y: cy + 0.55 * size, 'font-size': tlSize }, firstReading(tl)),
    );
    word.dot.replaceWith(link);
    link.prepend(word.dot);
    // a plain click (or Enter) opens the word's card in place; a modified click still follows the link
    link.addEventListener('click', (event) => {
      if (!onWord || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onWord({ hanji, tl }, link);
    });
    word.link = link;
  };

  const bubbles = tags.map((tag, i) => {
    const { r } = nodes[i];
    const label = tagLabel(tag.name);
    const words = packWords(r, tag.words);
    const wordLayer = svg('g', { class: 'tag-words' }, words.map((word) => word.dot));
    const target = svg(
      'circle',
      { class: 'tag-circle', r, role: 'button', tabindex: '0', 'aria-label': label },
      svg('title', {}, tag.tl ? `${label} ${tag.tl}` : label),
    );
    // the name with its Tâi-lô under it; a long Latin label (English) shrinks to stay inside the
    // circle, about 0.55em per letter across 1.6 radii
    const nameSize = Math.min(24, Math.max(13, r * 0.3), (1.6 * r) / (0.55 * [...label].length));
    const name = svg(
      'g',
      { class: 'tag-name', 'aria-hidden': 'true' },
      // 0.3em above the centre, back on it when the 台羅 switch is off (styles.css)
      svg('text', { class: 'tag-hanji', y: -0.3 * nameSize, 'font-size': nameSize }, label),
      svg('text', { class: 'tag-tl', y: 0.62 * nameSize, 'font-size': 0.55 * nameSize }, tag.tl),
    );
    // the shadow reaches 12% past the circle and sits a little low, as light from above would cast it
    const shadow = svg('circle', { class: 'tag-shadow', cy: r * 0.04, r: r * 1.12, fill: 'url(#bubble-shadow)' });
    const body = svg('g', {}, shadow, target, wordLayer, name);
    return { tag, node: nodes[i], target, words, body, group: svg('g', { class: 'tag-bubble' }, body) };
  });
  map.append(...bubbles.map((b) => b.group));
  const deepest = Math.min(...bubbles.flatMap((b) => b.words.map((word) => word.size)));
  return { map, bubbles, deepest, reveal };
}

// The entrance, on its own timer (the simulation may cool before the last bubble is due): bubbles
// bloom from the centre outwards, each springing open past its size and settling back, while a
// gentle reheat eases them out from slightly drawn in. Returns the timer.
function playEntrance(d3, nodes, simulation, place) {
  const order = [...nodes].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  order.forEach((node, rank) => {
    const share = rank / Math.max(1, order.length - 1);
    node.delay = ENTRANCE_SPAN_MS * share ** 1.3 + (Math.random() - 0.5) * ENTRANCE_JITTER_MS;
    node.entry = 0;
    node.x *= ENTRANCE_SPREAD;
    node.y *= ENTRANCE_SPREAD;
  });
  const pop = d3.easeBackOut.overshoot(1.4);
  const timer = d3.timer((elapsed) => {
    let done = true;
    for (const node of nodes) {
      const progress = Math.min(1, Math.max(0, (elapsed - node.delay) / ENTRANCE_POP_MS));
      node.entry = progress === 0 ? 0 : pop(progress);
      if (progress < 1) done = false;
    }
    place();
    if (done) timer.stop();
  });
  simulation.alpha(0.3).restart();
  return timer;

}

// The view the map shows, drawn as a CSS transform of the whole <svg> against its fixed viewBox
// (the root view). A view is [centre x, centre y, width] in svg units, as d3.interpolateZoom takes
// it; every view is kept between the root view's width and `minWidth`, its centre inside the root
// view. moveTo jumps to a view, zoomTo eases there, halt stops an eased zoom where it is; scaled
// gives a view zoomed by a factor about a point of the box (px from its top left).
function makeCamera(d3, map, rootView, width, height, minWidth) {
  const [rootX, rootY, rootWidth] = rootView;
  const reachX = rootWidth / 2;
  const reachY = (rootWidth * height) / width / 2;
  const keep = ([x, y, w]) => [
    Math.min(rootX + reachX, Math.max(rootX - reachX, x)),
    Math.min(rootY + reachY, Math.max(rootY - reachY, y)),
    Math.min(rootWidth, Math.max(minWidth, w)),
  ];
  let view = rootView;
  let timer = null;
  let settling = null;
  const listeners = [];
  // while the view moves, the <svg> is its own compositor layer (styles.css .moving): scaling it
  // costs no repaint, though it stays as sharp as when the move began; SETTLE_MS after the last
  // move it is painted again at its scale
  const moveTo = (next) => {
    map.classList.add('moving');
    clearTimeout(settling);
    settling = setTimeout(() => map.classList.remove('moving'), SETTLE_MS);
    view = keep(next);
    const [x, y, w] = view;
    const k = rootWidth / w;
    const cx = ((x - rootX) * width) / rootWidth + width / 2;
    const cy = ((y - rootY) * width) / rootWidth + height / 2;
    map.style.transform = `translate(${width / 2 - k * cx}px, ${height / 2 - k * cy}px) scale(${k})`;
    for (const listener of listeners) listener();
  };
  const halt = () => {
    timer?.stop();
    timer = null;
  };
  const zoomTo = (target) => {
    halt();
    const path = d3.interpolateZoom(view, keep(target));
    if (reducedMotion.matches) return moveTo(path(1));
    timer = d3.timer((elapsed) => {
      const progress = Math.min(1, elapsed / ZOOM_MS);
      moveTo(path(d3.easeCubicInOut(progress)));
      if (progress === 1) halt();
    });
  };
  // the svg point under (px, py) stays under it
  const scaled = (factor, px = width / 2, py = height / 2, from = view) => {
    const [x, y, w] = from;
    const next = Math.min(rootWidth, Math.max(minWidth, w / factor));
    const perPx = w / width;
    const nextPerPx = next / width;
    return [x + (px - width / 2) * (perPx - nextPerPx), y + (py - height / 2) * (perPx - nextPerPx), next];
  };
  return {
    view: () => view,
    zoomLevel: () => rootWidth / view[2],
    moveTo,
    zoomTo,
    halt,
    scaled,
    onChange: (listener) => listeners.push(listener),
    stop: () => {
      timer?.stop();
      clearTimeout(settling);
    },
  };
}

// Level of detail, checked a moment after the view moves (DETAIL_DELAY_MS, at most that often
// during a pinch): a word in view whose Hanji would be at least READ_PX tall shows its text (fading
// in), a tag at least OPEN_PX across the radius opens (its name gives way, its words take clicks and
// Tab, the closed tags dim), and the bar offers 全部標籤 while zoomed and the open tag's page.
function detailControls({ map, bar, all, bubbles, camera, width, height, onZoomIn, reveal }) {
  let pending = null;
  let wentIn = false;
  // the tag the bar's link names
  let linked = null;
  const schedule = () => {
    pending ??= setTimeout(refresh, DETAIL_DELAY_MS);
  };
  const refresh = () => {
    pending = null;
    // new links are built a batch at a time, the rest on the next pass, so no frame does them all
    let budget = REVEAL_BATCH;
    const [x, y, w] = camera.view();
    const unitPx = width / w;
    const halfWidth = w / 2;
    const halfHeight = (w * height) / width / 2;
    let centred = null;
    let centredDistance = Infinity;
    for (const b of bubbles) {
      const { x: bx, y: by, r } = b.node;
      const onScreen = Math.abs(bx - x) < halfWidth + r && Math.abs(by - y) < halfHeight + r;
      const open = onScreen && r * unitPx >= OPEN_PX;
      b.group.classList.toggle('open', open);
      if (open) {
        const distance = Math.hypot(bx - x, by - y);
        if (distance < centredDistance) [centred, centredDistance] = [b, distance];
      }
      if (!onScreen && !b.anyShown) continue;
      b.anyShown = false;
      for (const word of b.words) {
        const shown = onScreen && word.size * unitPx >= READ_PX;
        if (shown && !word.link) {
          if (budget === 0) {
            schedule();
            continue;
          }
          budget -= 1;
          reveal(word);
        }
        if (!word.link) continue;
        // only real changes touch the DOM: an unchanged attribute set again still restyles
        if (word.link.classList.contains('shown') !== shown) word.link.classList.toggle('shown', shown);
        const tabindex = shown && open ? '0' : '-1';
        if (word.link.getAttribute('tabindex') !== tabindex) word.link.setAttribute('tabindex', tabindex);
        b.anyShown ||= shown;
      }
    }
    const zoomed = camera.zoomLevel() > ZOOMED_AT;
    map.classList.toggle('has-open', centred !== null);
    if (bar.dataset.empty !== String(!zoomed)) bar.dataset.empty = String(!zoomed);
    all.style.visibility = centred ? '' : 'hidden';
    if (centred && centred !== linked) {
      all.href = tagRoute(centred.tag.name);
      all.textContent = t('map.seeAll', { count: formatNumber(centred.tag.count) });
    }
    linked = centred;
    if (zoomed && !wentIn) {
      wentIn = true;
      onZoomIn();
    }
  };
  refresh();
  return { schedule, stop: () => clearTimeout(pending) };
}

// Zooming into a tag and back out. A click (or Enter / Space) on a tag zooms until it fills the box;
// a click on the empty space around the circles, Escape or 全部標籤 zooms back out. Zoomed in by any
// means, the bodies hold still (a hover swell is undone at once). Returns { zoomOut }.
function zoomControls({ map, bubbles, nodes, reach, collide, simulation, aspect, rootView, camera, place }) {
  const tagView = (node) => [node.x, node.y, 2.04 * node.r * Math.max(1, aspect)];
  let last = null;
  let still = false;
  camera.onChange(() => {
    const zoomed = camera.zoomLevel() > ZOOMED_AT;
    if (zoomed === still) return;
    still = zoomed;
    if (!zoomed) return;
    // with the simulation stopped, no later tick would finish easing a swell
    for (const node of nodes) {
      node.grow = 1;
      node.scale = 1;
    }
    collide.radius(reach);
    simulation.stop();
    place();
  });
  const zoomIn = (index) => {
    last = bubbles[index].target;
    camera.zoomTo(tagView(nodes[index]));
  };
  const zoomOut = ({ refocus = false } = {}) => {
    if (camera.zoomLevel() <= ZOOMED_AT) return;
    camera.zoomTo(rootView);
    if (refocus) last?.focus({ preventScroll: true });
  };
  bubbles.forEach((b, i) => {
    b.target.addEventListener('click', () => zoomIn(i));
    b.target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      zoomIn(i);
    });
  });
  map.addEventListener('click', (event) => {
    if (event.target === map) zoomOut();
  });
  return { zoomOut };
}

// Dragging with the mouse pans the view (touch keeps scrolling the page; two fingers pinch, see
// gestureControls); the click that ends a drag is swallowed before any bubble sees it. Returns
// { isDragging }.
function panControls({ map, camera, width }) {
  let drag = null;
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
      camera.halt();
      drag.start = camera.view();
      map.setPointerCapture(drag.id);
      map.classList.add('panning');
    }
    const perPx = drag.start[2] / width;
    camera.moveTo([drag.start[0] - dx * perPx, drag.start[1] - dy * perPx, drag.start[2]]);
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
  return { isDragging: () => Boolean(drag?.start) };
}

// Free zoom about the fingers or the pointer: a trackpad pinch (Chrome and Firefox send it as a
// wheel event with ctrlKey; Safari as gesture events), Ctrl + wheel, and a two-finger pinch on a
// touch screen, which also pans. A plain wheel and a one-finger swipe keep scrolling the page.
function gestureControls({ map, camera, width, height }) {
  const box = map.parentElement;
  const pointIn = (clientX, clientY) => {
    const rect = box.getBoundingClientRect();
    return [((clientX - rect.left) * width) / rect.width, ((clientY - rect.top) * height) / rect.height];
  };
  map.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      camera.halt();
      camera.moveTo(camera.scaled(Math.exp(-event.deltaY * WHEEL_RATE), ...pointIn(event.clientX, event.clientY)));
    },
    { passive: false },
  );
  // Safari's trackpad pinch: scale is relative to where the gesture began
  let gesture = null;
  map.addEventListener('gesturestart', (event) => {
    event.preventDefault();
    camera.halt();
    gesture = { view: camera.view(), at: pointIn(event.clientX, event.clientY) };
  });
  map.addEventListener('gesturechange', (event) => {
    if (!gesture) return;
    event.preventDefault();
    camera.moveTo(camera.scaled(event.scale, ...gesture.at, gesture.view));
  });
  map.addEventListener('gestureend', () => {
    gesture = null;
  });
  // two fingers: the distance between them zooms, their midpoint pans
  let pinch = null;
  const fingers = (touches) => {
    const [a, b] = touches;
    const [ax, ay] = pointIn(a.clientX, a.clientY);
    const [bx, by] = pointIn(b.clientX, b.clientY);
    return { mid: [(ax + bx) / 2, (ay + by) / 2], distance: Math.hypot(ax - bx, ay - by) };
  };
  map.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 2) return;
      camera.halt();
      pinch = { view: camera.view(), ...fingers(event.touches) };
    },
    { passive: true },
  );
  map.addEventListener(
    'touchmove',
    (event) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const now = fingers(event.touches);
      const [x, y, w] = camera.scaled(now.distance / pinch.distance, ...pinch.mid, pinch.view);
      const perPx = w / width;
      camera.moveTo([x - (now.mid[0] - pinch.mid[0]) * perPx, y - (now.mid[1] - pinch.mid[1]) * perPx, w]);
    },
    { passive: false },
  );
  map.addEventListener('touchend', (event) => {
    if (event.touches.length < 2) pinch = null;
  });
}
