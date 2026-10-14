import { calendarDate } from "@/shared/journal/limits";

// Invented shows at real Bay Area museums, dated from the day the test runs so every timing has something to list.

const DAY = 86_400_000;
const today = calendarDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
const shift = (days: number) => new Date(Date.parse(today) + days * DAY).toISOString().slice(0, 10);
const period = (opensIn: number | null, closesIn: number) => ({
  startDate: opensIn === null ? null : shift(opensIn),
  endDate: shift(closesIn),
});

export const SF_MOMA = { lat: 37.785718, lng: -122.401051 };

// "United Kingdom" sorts after the Bay Area, which Explore opens on without a location fix.
export const regions = [
  { region: "country:GB", lat: 50.2153, lng: -5.4826 },
  { region: "sf-bay-area", ...SF_MOMA },
];

const show = (
  exhibitionId: string,
  museumId: string,
  title: string,
  ...viewingPeriods: ReturnType<typeof period>[]
) => ({
  exhibitionId,
  museumId,
  title,
  sourceUrl: `https://www.${museumId}.org/exhibitions/${exhibitionId}`,
  viewingPeriods,
});

export const bayArea = {
  museums: [
    { museumId: "sfmoma", name: "San Francisco Museum of Modern Art", city: "San Francisco", ...SF_MOMA },
    {
      museumId: "bampfa",
      name: "Berkeley Art Museum and Pacific Film Archive",
      city: "Berkeley",
      lat: 37.870804,
      lng: -122.26634,
    },
    { museumId: "omca", name: "Oakland Museum of California", city: null, lat: 37.798641, lng: -122.263611 },
  ],
  exhibitions: [
    show("tides", "omca", "Tides of Memory", period(-100, 8)),
    show("fog", "sfmoma", "Fog Studies", period(-38, 14)),
    { ...show("signal", "sfmoma", "Signal and Noise", period(-9, 69)), imageUrl: "https://cdn.example.net/signal.jpg" },
    show("orchard", "bampfa", "Orchard Light", period(13, 147)),
    show("returning", "bampfa", "The Returning Room", period(-60, -5), period(6, 30)),
    show("collection", "sfmoma", "Collection in Focus", period(null, 120)),
    show("ended", "omca", "Last Light", period(-90, -3)),
  ],
};

export const cornwall = {
  museums: [{ museumId: "tate", name: "Tate St Ives", city: "St Ives", lat: 50.2153, lng: -5.4826 }],
  exhibitions: [show("harbour", "tate", "Harbour Drawings", period(-40, 10))],
};

// Long runs only, so nothing closes within the Ending soon window.
export const london = {
  museums: [{ museumId: "london-museum", name: "London Museum", city: "London", lat: 51.5176, lng: -0.0968 }],
  exhibitions: [
    show("river", "london-museum", "River Rooms", period(-45, 90)),
    show("undated", "london-museum", "Undated Collection", period(null, 200)),
  ],
};
