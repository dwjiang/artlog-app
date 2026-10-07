import type { Exhibition, ExploreData, ExploreFriend, ExploreMuseum } from "./types";

// These Chicago shows are invented; each image is a real public-domain work from the Art
// Institute of Chicago. Dates sit at fixed offsets from today so every timing always has something to list.

const aicImage = (id: string, label: string) => ({
  uri: `https://www.artic.edu/iiif/2/${id}/full/843,/0/default.jpg`,
  label,
});

const MAYA: ExploreFriend = { profileId: "sample-maya", name: "Maya", avatar: "klee" };
const JONAH: ExploreFriend = { profileId: "sample-jonah", name: "Jonah", avatar: "sharaku" };
const PRIYA: ExploreFriend = { profileId: "sample-priya", name: "Priya", avatar: "redon-flowers" };
const SAM: ExploreFriend = { profileId: "sample-sam", name: "Sam", avatar: "fayum" };

const MUSEUMS: ExploreMuseum[] = [
  {
    id: "aic",
    name: "Art Institute of Chicago",
    shortName: "Art Institute",
    lat: 41.8796,
    lng: -87.6237,
    distanceMiles: 0.6,
    hoursToday: "Open until 5 PM",
    admission: "$32",
    photo: require("../../../assets/museums/art-institute.jpg"),
  },
  {
    id: "mca",
    name: "Museum of Contemporary Art Chicago",
    shortName: "MCA Chicago",
    lat: 41.8972,
    lng: -87.6212,
    distanceMiles: 1.4,
    hoursToday: "Open until 5 PM",
    admission: "$22",
  },
  {
    id: "wrightwood",
    name: "Wrightwood 659",
    shortName: "Wrightwood 659",
    lat: 41.929,
    lng: -87.646,
    distanceMiles: 3.9,
    hoursToday: "Closed today",
    admission: "$15",
  },
  {
    id: "smart",
    name: "Smart Museum of Art",
    shortName: "Smart Museum",
    lat: 41.7934,
    lng: -87.6003,
    distanceMiles: 7.8,
    hoursToday: "Open until 5 PM",
    admission: "Free",
  },
];

type SampleShow = Omit<Exhibition, "startsOn" | "endsOn"> & { opensIn: number; closesIn: number };

const SHOWS: SampleShow[] = [
  {
    id: "hokusai",
    title: "Hokusai: Views of Mount Fuji",
    museumId: "aic",
    opensIn: -93,
    closesIn: 8,
    image: aicImage("b3974542-b9b4-7568-fc4b-966738f61d78", "Katsushika Hokusai, Under the Wave off Kanagawa"),
    friends: [MAYA, JONAH, SAM, PRIYA],
  },
  {
    id: "utamaro",
    title: "Utamaro and the Floating World",
    museumId: "smart",
    opensIn: -38,
    closesIn: 14,
    image: aicImage("2b9f4057-ec33-864f-7c14-665da35a05bc", "Kitagawa Utamaro, The Courtesan Arihara of the Tsuruya"),
    friends: [PRIYA],
  },
  {
    id: "monet",
    title: "Monet and the Water Garden",
    museumId: "aic",
    opensIn: -22,
    closesIn: 106,
    image: aicImage("3c27b499-af56-f0d5-93b5-a7f2f1ad5813", "Claude Monet, Water Lilies"),
    friends: [MAYA, SAM],
  },
  {
    id: "mondrian",
    title: "Mondrian: Toward the Grid",
    museumId: "wrightwood",
    opensIn: -9,
    closesIn: 69,
    image: aicImage("25f660ee-f1db-d13b-42a5-56df97c98ba7", "Piet Mondrian, Lozenge Composition"),
    friends: [],
  },
  {
    id: "kandinsky",
    title: "Kandinsky: Painting Music",
    museumId: "mca",
    opensIn: 13,
    closesIn: 147,
    image: aicImage("b5bc6b66-9e6e-fe57-dcec-fc49e820e904", "Vasily Kandinsky, Improvisation No. 30 (Cannons)"),
    friends: [MAYA, PRIYA, SAM],
  },
  {
    id: "cassatt",
    title: "Mary Cassatt at Home",
    museumId: "aic",
    opensIn: 20,
    closesIn: 126,
    image: aicImage("3b885ae0-4d46-5fe4-d70a-00474827f02c", "Mary Cassatt, The Child's Bath"),
    friends: [],
  },
  {
    id: "vigee",
    title: "Vigée Le Brun: Portraits of a Court",
    museumId: "smart",
    opensIn: 34,
    closesIn: 161,
    image: aicImage("34ef109b-1fba-7e07-e58b-0b5fcf82621f", "Élisabeth Louise Vigée Le Brun, Queen Marie Antoinette"),
    friends: [JONAH],
  },
];

const DAY = 86_400_000;
const shift = (today: string, days: number) => new Date(Date.parse(today) + days * DAY).toISOString().slice(0, 10);

const CITIES = [{ id: "chicago", name: "Chicago" }];

export function sampleExplore(today: string, cityId?: string): ExploreData {
  return {
    city: CITIES.find((city) => city.id === cityId) ?? CITIES[0],
    cities: CITIES,
    today,
    museums: MUSEUMS,
    exhibitions: SHOWS.map(({ opensIn, closesIn, ...show }) => ({
      ...show,
      startsOn: shift(today, opensIn),
      endsOn: shift(today, closesIn),
    })),
  };
}
