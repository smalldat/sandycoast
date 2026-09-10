// Vite's `?raw` import suffix (used by react/App.tsx to show an example's
// literal source next to its live render) has no ambient type by default.
declare module '*?raw' {
  const content: string;
  export default content;
}
