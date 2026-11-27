// Settings panel (語言, 外觀, 字型, 台羅, 白話字, 方音符號), after kautian-mirror's: each choice is a
// <html data-*> attribute that styles.css keys on; index.html re-applies the stored choices before
// first paint. kautian-mirror shares the origin and the "settings" key, so a write merges into what
// is stored there: 外觀 and the reading switches carry across both sites and kautian's own switches
// survive. 字型 and 語言 are this site's own ("community-settings"): kautian-mirror stores its
// default font (芫荽) with every change, which would otherwise replace this site's 系統 default.

const SHARED_KEY = 'settings';
const OWN_KEY = 'community-settings';
const OWN_SETTINGS = new Set(['font', 'lang']);

// checkboxes store "on" / "off" so every setting is a plain data-* string
const controlValue = (control) => (control.type === 'checkbox' ? (control.checked ? 'on' : 'off') : control.value);

// Merges `choices` into what `key` holds; private mode or blocked site data keeps them for this view.
function store(key, choices) {
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(stored && typeof stored === 'object' ? { ...stored, ...choices } : choices));
  } catch {
    // the choice lasts this page view
  }
}

// `onChange(settings)` runs after every change, with all of the form's current choices.
export function initSettings(form, onChange = () => {}) {
  const root = document.documentElement;
  // index.html already restored the stored choices onto <html>; unknown values keep the markup default
  for (const control of form.elements) {
    const value = root.dataset[control.name];
    if (value === undefined) continue;
    if (control.type === 'checkbox') control.checked = value === 'on';
    else if ([...control.options].some((option) => option.value === value)) control.value = value;
  }
  // no text field, but Enter on a switch could still submit the form and reload the page
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', () => {
    const settings = Object.fromEntries([...form.elements].map((control) => [control.name, controlValue(control)]));
    Object.assign(root.dataset, settings);
    const entries = Object.entries(settings);
    store(SHARED_KEY, Object.fromEntries(entries.filter(([name]) => !OWN_SETTINGS.has(name))));
    store(OWN_KEY, Object.fromEntries(entries.filter(([name]) => OWN_SETTINGS.has(name))));
    onChange(settings);
  });
}
