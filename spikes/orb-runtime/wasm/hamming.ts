// Fixed scratch buffers: 1,000 descriptors per side, then 1,000 result triples.
export function match(queryCount: i32, refCount: i32, ratio: f64, maxDistance: i32): i32 {
  if (queryCount < 0 || queryCount > 1000 || refCount < 0 || refCount > 1000) unreachable();
  let count = 0;
  for (let i = 0; i < queryCount; i++) {
    let best = 257;
    let second = 257;
    let bestIdx = -1;
    for (let j = 0; j < refCount; j++) {
      let distance = 0;
      for (let word = 0; word < 8; word++) {
        distance += i32(popcnt<u32>(
          load<u32>(usize(i * 32 + word * 4)) ^ load<u32>(usize(32000 + j * 32 + word * 4)),
        ));
      }
      if (distance < best) {
        second = best;
        best = distance;
        bestIdx = j;
      } else if (distance < second) {
        second = distance;
      }
    }
    if (bestIdx >= 0 && best <= maxDistance && f64(best) < ratio * f64(second)) {
      const out = usize(64000 + count * 12);
      store<i32>(out, i);
      store<i32>(out + 4, bestIdx);
      store<i32>(out + 8, best);
      count++;
    }
  }
  return count;
}
