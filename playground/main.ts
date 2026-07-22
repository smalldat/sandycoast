import { loadActive, saveActive } from './persist.js';
import { COMPONENTS, type DemoComponent } from './registry.js';

const navEl = document.getElementById('nav')!;
const hostEl = document.getElementById('host')!;
const panelEl = document.getElementById('panel')!;

let active: DemoComponent | null = null;
const buttons = new Map<DemoComponent, HTMLButtonElement>();

function select(comp: DemoComponent, btn: HTMLButtonElement): void {
  if (comp.disabled || comp === active) return;
  active?.unmount();
  for (const el of navEl.querySelectorAll('button')) el.classList.remove('active');
  btn.classList.add('active');
  active = comp;
  comp.mount(hostEl, panelEl);
  saveActive(comp.id);
}

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
