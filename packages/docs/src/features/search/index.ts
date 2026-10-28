export interface SearchItem { name: string; description: string; href: string; kind: string; keywords?: readonly string[]; }
const stopWords = new Set(["a", "an", "and", "are", "do", "for", "how", "i", "in", "is", "of", "the", "to", "with"]);
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase();
const words = (value: string) => [...new Set([
  ...(normalize(value).match(/[\p{Letter}\p{Number}]+/gu) ?? []),
  ...(normalize(value.replace(/([a-z])([A-Z])/g, "$1 $2")).match(/[\p{Letter}\p{Number}]+/gu) ?? []),
])];

/** One insertion, deletion, substitution or adjacent transposition. */
function near(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  while (i < left.length && left[i] === right[i]) i++;
  if (left.length === right.length) return left.slice(i + 1) === right.slice(i + 1)
    || left[i] === right[i + 1] && left[i + 1] === right[i] && left.slice(i + 2) === right.slice(i + 2);
  return left.length > right.length ? left.slice(i + 1) === right.slice(i) : left.slice(i) === right.slice(i + 1);
}

/** Index once; query terms intersect weighted title/body postings. */
export function createSearchIndex(items: readonly SearchItem[]) {
  const postings = new Map<string, Map<number, number>>();
  items.forEach((item, id) => {
    for (const [text, weight] of [[item.description, 1], [(item.keywords ?? []).join(" "), 8], [item.name, 12]] as const) {
      for (const word of new Set(words(text))) {
        if (!postings.has(word)) postings.set(word, new Map());
        postings.get(word)!.set(id, weight);
      }
    }
  });
  return (query: string, limit = 12): SearchItem[] => {
    const terms = [...new Set(words(query).filter(word => !stopWords.has(word)))].slice(0, 12);
    if (!terms.length) return [];
    const find = (fuzzy: boolean) => {
      let matches: Map<number, number> | undefined;
      for (const term of terms) {
        const candidates = new Map<number, number>();
        for (const [word, documents] of postings) {
          const factor = word === term ? 1 : word.startsWith(term) ? .7 : fuzzy && term.length >= 5 && near(term, word) ? .35 : 0;
          if (!factor) continue;
          const rarity = 1 + Math.log(1 + items.length / documents.size);
          for (const [id, weight] of documents) candidates.set(id, Math.max(candidates.get(id) ?? 0, weight * factor * rarity));
        }
        matches = matches === undefined ? candidates : new Map([...matches].filter(([id]) => candidates.has(id)).map(([id, score]) => [id, score + candidates.get(id)!]));
        if (!matches.size) break;
      }
      const phrase = normalize(query).replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
      return [...(matches ?? [])].map(([id, score]) => {
        const item = items[id]!;
        const title = words(item.name).join(" ");
        const identifier = normalize(item.name).replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
        return { item, score: score + (identifier === phrase || title === phrase ? 300 : title.startsWith(phrase) ? 100 : title.includes(phrase) ? 60 : 0) };
      }).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
    };
    const exact = find(false);
    const seen = new Set<string>();
    return (exact.length ? exact : find(true)).filter(({ item }) => {
      if (seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    }).slice(0, limit).map(({ item }) => item);
  };
}

export function searchExcerpt(text: string, query: string): string {
  const terms = words(query).filter(word => !stopWords.has(word));
  const positions = terms.map(term => normalize(text).indexOf(term)).filter(position => position >= 0);
  const position = positions.length ? Math.min(...positions) : 0;
  const start = position > 65 ? text.lastIndexOf(" ", position - 45) + 1 : 0;
  const excerpt = text.slice(start, start + 155).trim();
  return `${start ? "…" : ""}${excerpt}${start + 155 < text.length ? "…" : ""}`;
}
