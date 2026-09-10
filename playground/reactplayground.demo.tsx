import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { App } from './react/App.js';
import type { DemoComponent } from './registry.js';

// Deliberately simple next to the other demos: no persisted config, no
// control panel — just a tab per chart type showing basic `@smalldat/sandycoast/react`
// usage next to the source that produced it (see react/App.tsx).
class ReactPlaygroundDemo implements DemoComponent {
  id = 'react';
  label = 'React bindings';
  preferredLayout = 'tb' as const;

  private root: Root | null = null;

  mount(host: HTMLElement, panel: HTMLElement): void {
    panel.replaceChildren();
    const note = document.createElement('p');
    note.className = 'status';
    note.textContent = 'No control panel here — this demo is about the source, not the knobs.';
    panel.append(note);

    host.replaceChildren();
    this.root = createRoot(host);
    this.root.render(<App />);
  }

  unmount(): void {
    this.root?.unmount();
    this.root = null;
  }
}

export const reactPlaygroundDemo: DemoComponent = new ReactPlaygroundDemo();
