import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accentEntry, KEY } from './fixtures.js';

// Renders word cards (site/cards.js) against a minimal in-memory DOM: enough elements, attributes
// and text to read back what a card shows.

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.style = {};
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  after() {}
  addEventListener() {}
  get textContent() {
    return this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
  }
  // every element below this one, depth first
  *walk() {
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      yield child;
      yield* child.walk();
    }
  }
}

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (_, tag) => new FakeElement(tag),
  getElementById: () => new FakeElement('div'),
  documentElement: new FakeElement('html'),
};
globalThis.location = { origin: 'https://taigikeyboard.tw', pathname: '/community-dictionary/', hash: '#/' };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.IntersectionObserver = class {
  observe() {}
  disconnect() {}
};

const { cardList } = await import('../site/cards.js');

const attestation = (fields) => {
  const { hanji, tl, ...rest } = { ...accentEntry(), ...fields };
  return rest;
};

function renderCard(row, user = null) {
  const list = new FakeElement('div');
  cardList(list, [row], { headword: true, user });
  const card = list.children[0];
  const byClass = (name) => [...card.walk()].find((el) => el.attributes.class === name);
  return { card, byClass, edit: [...card.walk()].find((el) => el.attributes.href?.startsWith('#/edit/')) };
}

test('a community card credits the GitHub login and offers 修改', () => {
  const { byClass, edit } = renderCard({ key: KEY, hanji: '八', tl: 'pueh', attestations: [attestation({})] });
  assert.match(byClass('card-credit').textContent, /octocat/);
  assert.doesNotMatch(byClass('card-credit').textContent, /iTaigi/);
  assert.equal(edit.attributes.href, `#/edit/octocat/${KEY}`);
});

test('an iTaigi card credits its iTaigi contributors, links iTaigi, lists editors and offers 修改', () => {
  const row = {
    key: KEY,
    hanji: '青花',
    tl: 'tshenn-hue',
    attestations: [attestation({ contributor: 'taigikeyboard', contributor_id: 241070258, itaigi_contributors: ['阿明'], editors: [{ login: 'octocat', id: 583231 }] })],
  };
  const { byClass, edit } = renderCard(row);
  const credit = byClass('card-credit').textContent;
  assert.match(credit, /阿明/);
  assert.match(credit, /iTaigi/);
  assert.match(credit, /octocat/);
  assert.doesNotMatch(credit, /taigikeyboard/);
  assert.equal(edit.attributes.href, `#/edit/taigikeyboard/${KEY}`);
});
