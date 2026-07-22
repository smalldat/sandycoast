// Declarative control-panel generator: a spec of controls is turned into DOM
// inputs that read from / write into a plain config object. On any change the
// host calls back so it can rebuild the (construct-time) component.

export type Control =
  | { kind: 'slider'; label: string; path: string; min: number; max: number; step: number }
  | { kind: 'number'; label: string; path: string; min?: number; max?: number; step?: number }
  | { kind: 'select'; label: string; path: string; options: { value: string; label: string }[] }
  | { kind: 'checkbox'; label: string; path: string }
  | { kind: 'color'; label: string; path: string }
  | { kind: 'text'; label: string; path: string }
  // Multi-select set stored as a string[] at `path`.
  | { kind: 'checkgroup'; label: string; path: string; options: string[] }
  // Array of color strings of fixed length stored at `path`.
  | { kind: 'colorlist'; label: string; path: string; count: number };

export interface ControlGroup {
  title: string;
  controls: Control[];
}

// Minimal typed getter/setter over a dotted path ("axes.y.ticks").
function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  let cur = obj;
  for (const k of keys) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[last] = value;
}

function field(label: string, input: HTMLElement, extra?: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'ctl';
  const name = document.createElement('span');
  name.className = 'ctl-label';
  name.textContent = label;
  wrap.append(name, input);
  if (extra) wrap.append(extra);
  return wrap;
}

/**
 * Render `groups` into `mount`, editing `cfg` in place. `onChange` fires after
 * every edit (debounced not needed — rebuild is cheap here).
 */
export function renderControls(
  mount: HTMLElement,
  cfg: Record<string, unknown>,
  groups: ControlGroup[],
  onChange: () => void,
): void {
  mount.replaceChildren();
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'ctl-group';
    const h = document.createElement('h3');
    h.textContent = group.title;
    section.append(h);
    for (const c of group.controls) section.append(buildControl(cfg, c, onChange));
    mount.append(section);
  }
}

function buildControl(cfg: Record<string, unknown>, c: Control, onChange: () => void): HTMLElement {
  const val = getPath(cfg, c.path);

  switch (c.kind) {
    case 'slider': {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(c.min);
      input.max = String(c.max);
      input.step = String(c.step);
      input.value = String(val ?? c.min);
      const out = document.createElement('span');
      out.className = 'ctl-value';
      out.textContent = input.value;
      input.addEventListener('input', () => {
        out.textContent = input.value;
        setPath(cfg, c.path, Number(input.value));
        onChange();
      });
      return field(c.label, input, out);
    }
    case 'number': {
      const input = document.createElement('input');
      input.type = 'number';
      if (c.min != null) input.min = String(c.min);
      if (c.max != null) input.max = String(c.max);
      if (c.step != null) input.step = String(c.step);
      input.value = String(val ?? '');
      input.addEventListener('change', () => {
        setPath(cfg, c.path, Number(input.value));
        onChange();
      });
      return field(c.label, input);
    }
    case 'select': {
      const input = document.createElement('select');
      for (const o of c.options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        input.append(opt);
      }
      input.value = String(val ?? c.options[0]?.value ?? '');
      input.addEventListener('change', () => {
        setPath(cfg, c.path, input.value);
        onChange();
      });
      return field(c.label, input);
    }
    case 'checkbox': {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(val);
      input.addEventListener('change', () => {
        setPath(cfg, c.path, input.checked);
        onChange();
      });
      return field(c.label, input);
    }
    case 'color': {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = typeof val === 'string' ? val : '#000000';
      input.addEventListener('input', () => {
        setPath(cfg, c.path, input.value);
        onChange();
      });
      return field(c.label, input);
    }
    case 'text': {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = typeof val === 'string' ? val : '';
      input.addEventListener('change', () => {
        setPath(cfg, c.path, input.value);
        onChange();
      });
      return field(c.label, input);
    }
    case 'checkgroup': {
      const box = document.createElement('div');
      box.className = 'ctl-checkgroup';
      const set = new Set(Array.isArray(val) ? (val as string[]) : []);
      for (const o of c.options) {
        const item = document.createElement('label');
        item.className = 'ctl-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = set.has(o);
        cb.addEventListener('change', () => {
          if (cb.checked) set.add(o);
          else set.delete(o);
          setPath(cfg, c.path, [...set]);
          onChange();
        });
        const span = document.createElement('span');
        span.textContent = o;
        item.append(cb, span);
        box.append(item);
      }
      return field(c.label, box);
    }
    case 'colorlist': {
      const box = document.createElement('div');
      box.className = 'ctl-colorlist';
      const arr = (Array.isArray(val) ? [...(val as string[])] : []).slice();
      for (let i = 0; i < c.count; i++) {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = arr[i] ?? '#888888';
        input.addEventListener('input', () => {
          arr[i] = input.value;
          setPath(cfg, c.path, arr.slice(0, c.count));
          onChange();
        });
        box.append(input);
      }
      return field(c.label, box);
    }
  }
}
