import { initChrome, trackChartSize } from './chrome.js';
import { loadActive, remapSavedColors, saveActive } from './persist.js';
import { COMPONENTS, type DemoComponent } from './registry.js';
import { colorRemap } from './theme.js';

const navEl = document.getElementById('nav')!;
const hostEl = document.getElementById('host')!;
const panelEl = document.getElementById('panel')!;

let active: DemoComponent | null = null;
const buttons = new Map<DemoComponent, HTMLButtonElement>();

function mount(comp: DemoComponent): void {
  comp.mount(hostEl, panelEl);
  trackChartSize(hostEl);
}

function select(comp: DemoComponent, btn: HTMLButtonElement): void {
  if (comp.disabled || comp === active) return;
  active?.unmount();
  for (const el of navEl.querySelectorAll('button')) el.classList.remove('active');
  btn.classList.add('active');
  active = comp;
  mount(comp);
  saveActive(comp.id);
}

// Chart colours live in each demo's config, so a theme switch has to migrate
// every saved config (not only the visible one) and rebuild the live chart —
// `mount` re-reads settings from storage, so remounting is enough.
initChrome(document.querySelector<HTMLElement>('.head-links')!, hostEl, (from, to) => {
  const map = colorRemap(from, to);
  for (const comp of COMPONENTS) remapSavedColors(comp.id, map);
  if (!active) return;
  active.unmount();
  mount(active);
});

for (const comp of COMPONENTS) {
  const btn = document.createElement('button');
  btn.className = 'nav-item';
  btn.textContent = comp.label;
  if (comp.disabled) {
    btn.classList.add('disabled');
    btn.title = 'Coming soon';
  }
  btn.addEventListener('click', () => select(comp, btn));
  navEl.append(btn);
  buttons.set(comp, btn);
}

// Restore the last-shown component; fall back to the first enabled one.
const savedId = loadActive();
const saved = COMPONENTS.find((c) => c.id === savedId && !c.disabled);
const firstComp = saved ?? COMPONENTS.find((c) => !c.disabled);
if (firstComp) {
  const btn = buttons.get(firstComp);
  if (btn) select(firstComp, btn);
}
