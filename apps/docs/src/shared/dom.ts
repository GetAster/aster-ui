export const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
