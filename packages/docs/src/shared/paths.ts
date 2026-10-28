export function documentationRoot(): URL {
  return new URL(document.querySelector('meta[name="aster-docs-root"]')?.getAttribute("content") ?? "./", location.href);
}

export function searchURL(): URL {
  const path = document.querySelector('meta[name="aster-docs-search"]')?.getAttribute("content");
  return path ? new URL(path, location.href) : new URL("search.json", documentationRoot());
}
