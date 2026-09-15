import type { Doc } from '../_generated/dataModel';
import type { JournalVenue } from '../../shared/journal/venue';

export function projectJournalVenue(venue: Doc<'museums'>): JournalVenue {
  return { id: venue._id, key: venue.key, name: venue.name, lat: venue.lat, lng: venue.lng, region: venue.region,
    website: venue.website, city: venue.city, cityKey: venue.cityKey, country: venue.country };
}
