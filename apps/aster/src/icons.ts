import { svg } from "lit-html";

const icon = (body: ReturnType<typeof svg>, box = 16) =>
  svg`<svg viewBox=${`0 0 ${box} ${box}`} aria-hidden="true">${body}</svg>`;

export const icons = {
  home: icon(svg`<path d="M2.5 7.5 8 3l5.5 4.5V13h-11z"/>`),
  projects: icon(svg`<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 6h5M5.5 9h3"/>`),
  people: icon(svg`<circle cx="8" cy="6" r="2.6"/><path d="M3 13.5c.6-2.5 2.6-4 5-4s4.4 1.5 5 4"/>`),
  edit: icon(svg`<path d="M10.5 3.5 12.5 5.5 6 12H4v-2zM9.5 4.5l2 2"/>`, 16),
  view: icon(svg`<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="2"/>`),
  addChild: icon(svg`<path d="M4 3v6.5h4.5M10.5 7v5M8 9.5h5"/>`),
  remove: icon(svg`<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"/>`),
  save: icon(svg`<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>`),
  cancel: icon(svg`<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`),
  move: icon(svg`<path d="M3 3.5v5h8M8.5 6l2.5 2.5L8.5 11"/>`),
  lock: icon(svg`<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`),
  tasks: icon(svg`<path d="M3 4h10M6 8h7M6 12h7M3.5 8v4"/>`),
  model: icon(svg`<rect x="2.5" y="2.5" width="4" height="4" rx=".8"/><rect x="9.5" y="9.5" width="4" height="4" rx=".8"/><path d="M4.5 6.5v5h5M9.5 4.5h2a2 2 0 0 1 2 2"/>`),
  links: icon(svg`<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6"/>`),
  time: icon(svg`<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>`),
  reports: icon(svg`<path d="M3 12.5V8M6.3 12.5V4M9.7 12.5V6.5M13 12.5V9.5"/>`),
  showcase: icon(svg`<rect x="2.5" y="2.5" width="4" height="4" rx=".8"/><rect x="9.5" y="2.5" width="4" height="4" rx=".8"/><rect x="2.5" y="9.5" width="4" height="4" rx=".8"/><rect x="9.5" y="9.5" width="4" height="4" rx=".8"/>`),
  folder: icon(svg`<path d="M2 5V3h4l2 2h6v8H2z"/>`),
  share: icon(svg`<path d="M7 1.5v7M4 4.5l3-3 3 3M2.5 8v4h9V8"/>`, 14),
  plus: icon(svg`<path d="M7 2.5v9M2.5 7h9"/>`, 14),
  density: icon(svg`<path d="M3 4.5h10M3 8h10M3 11.5h10"/>`),
  theme: icon(svg`<path d="M8 2.5a5.5 5.5 0 1 0 0 11c.8 0 1.2-.5 1.2-1.1 0-.7-.5-1-.5-1.6 0-.6.5-1 1.1-1h1.4a2.3 2.3 0 0 0 2.3-2.3c0-2.7-2.5-5-5.5-5z"/><circle cx="5.3" cy="7" r=".7"/><circle cx="7.6" cy="5" r=".7"/><circle cx="10.4" cy="5.6" r=".7"/>`),
  bulb: icon(svg`<path d="M5.6 10.4C4.6 9.6 4 8.4 4 7a4 4 0 0 1 8 0c0 1.4-.6 2.6-1.6 3.4-.4.3-.6.8-.6 1.3v.3H6.2v-.3c0-.5-.2-1-.6-1.3zM6.4 14h3.2"/>`),
};

/** The Aster mark at small sizes, as getaster.now's header draws it: heavy strokes, no gradients. */
export const asterMark = svg`<svg class="brand-mark" viewBox="0 0 512 512" aria-hidden="true">
  <rect width="512" height="512" rx="112" fill="#0B0F14"/>
  <polygon points="256,108 404,256 256,404 108,256" stroke="#78A6FF" stroke-width="28" stroke-linejoin="round" fill="none"/>
  <polygon points="360.65,151.35 360.65,360.65 151.35,360.65 151.35,151.35" stroke="#61D6C2" stroke-width="18" stroke-linejoin="round" fill="none"/>
  <circle cx="256" cy="256" r="20" fill="#E6C06B"/>
</svg>`;
