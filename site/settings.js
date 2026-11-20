// Settings panel (外觀, 字型, 白話字, 方音符號), after kautian-mirror's: each choice is a
// <html data-*> attribute that styles.css keys on, saved under "settings"; index.html re-applies
// it before first paint. kautian-mirror shares the origin and the key, so a write merges into
// what is stored: the shared choices carry across both sites and kautian's own switches survive.

const STORAGE_KEY = 'settings';

// checkboxes store "on" / "off" so every setting is a plain data-* string
const controlValue = (control) => (control.type === 'checkbox' ? (control.checked ? 'on' : 'off') : control.value);

export function initSettings(form) {
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
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const merged = stored && typeof stored === 'object' ? { ...stored, ...settings } : settings;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // private mode or blocked site data: the choice lasts this page view
    }
  });
}
