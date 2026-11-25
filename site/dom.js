// Element builders shared by the pages (app.js) and the tag bubbles (tag-map.js); children are
// nodes or strings (always text, never parsed as HTML).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) if (value != null) el.setAttribute(name, value);
  el.append(...children.flat().filter((c) => c != null));
  return el;
}
