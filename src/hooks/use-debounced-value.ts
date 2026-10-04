import { useEffect, useState } from "react";

/** Follows `value` only once it has stayed unchanged for `delay` ms. */
export function useDebouncedValue<T>(value: T, delay: number, initialValue: T): T {
  const [debounced, setDebounced] = useState(initialValue);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
