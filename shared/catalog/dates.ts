// An abbreviated range endpoint belongs to the first matching year at or after its start.
export function expandYearEnd(first: string, last: string): number {
  if (!last) return Number(first);
  let end = Number(first.slice(0, first.length - last.length) + last);
  if (last.length < first.length && end < Number(first)) end += 10 ** last.length;
  return end;
}
