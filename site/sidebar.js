// Sidebar toggle, after kautian-mirror's: wide screens slide the docked sidebar in and out
// (collapsed by default; <html data-sidebar="open">, remembered; index.html restores it before
// first paint); narrow screens open it as a popover drawer instead.

const STORAGE_KEY = 'sidebar';
// same breakpoint as the docked-sidebar @media in styles.css
const wideScreen = window.matchMedia('(min-width: 50rem)');

export function initSidebar(button, sidebar) {
  const root = document.documentElement;
  const syncExpanded = () => {
    const isOpen = wideScreen.matches ? root.dataset.sidebar === 'open' : sidebar.matches(':popover-open');
    button.setAttribute('aria-expanded', String(isOpen));
  };
  button.addEventListener('click', () => {
    if (!wideScreen.matches) return sidebar.togglePopover();
    if (root.dataset.sidebar === 'open') delete root.dataset.sidebar;
    else root.dataset.sidebar = 'open';
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(root.dataset.sidebar ?? 'closed'));
    } catch {
      // private mode or blocked site data: the state lasts this page view
    }
    syncExpanded();
  });
  sidebar.addEventListener('toggle', syncExpanded);
  // a drawer left open while the window widens would sit in the top layer over the docked sidebar
  wideScreen.addEventListener('change', () => {
    if (sidebar.matches(':popover-open')) sidebar.hidePopover();
    syncExpanded();
  });
  syncExpanded();
}
