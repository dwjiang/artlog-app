/**
 * The share grid shows every artwork in one order the person arranges. Left-out artworks keep their place, and the
 * places of included ones follow `shared`, the order the draft will publish.
 */
export function arrangeShareGrid(layout: string[], shared: string[], all: string[]): string[] {
  const present = new Set(all);
  const places = layout.filter((id) => present.has(id));
  const placed = new Set(places);
  places.push(...all.filter((id) => !placed.has(id)));
  const included = new Set(shared);
  const queue = shared.filter((id) => present.has(id));
  return places.map((id) => (included.has(id) ? queue.shift()! : id));
}

export function sharedOrder(grid: string[], included: ReadonlySet<string>): string[] {
  return grid.filter((id) => included.has(id));
}
