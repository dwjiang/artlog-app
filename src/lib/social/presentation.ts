import { isCalendarDate, LIMITS, normalizeSearch } from '@/shared/journal/limits';
import type { FriendshipAction, Relationship } from './types';

export function visitDate(value: string, locale?: string, format: 'full' | 'short' = 'full'): string {
  if (!isCalendarDate(value)) return 'Date unavailable';
  return new Intl.DateTimeFormat(locale, { month: format === 'short' ? 'short' : 'long', day: 'numeric',
    year: format === 'full' ? 'numeric' : undefined, timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return [words[0], words.length > 1 ? words.at(-1) : undefined]
    .filter(Boolean).map((word) => Array.from(word!)[0]).join('').toLocaleUpperCase() || '?';
}

export function peopleSearch(value: string): string | undefined {
  const normalized = normalizeSearch(value);
  return value.length <= LIMITS.searchMax && normalized.length >= LIMITS.searchMin &&
    normalized.length <= LIMITS.searchMax && normalized.split(' ').length <= 16 ? normalized : undefined;
}

export function friendshipActions(state: Relationship, viewerId: string): FriendshipAction[] {
  if (state.blocked) return [];
  if (state.state === 'accepted') return ['remove'];
  if (state.state === 'pending') return state.requesterId === viewerId ? ['cancel'] : ['accept', 'decline'];
  return ['request'];
}
