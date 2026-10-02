import { v } from "convex/values";

export const AVATAR_GROUPS = ["Portraits", "Landscapes", "Still lifes", "Abstract"] as const;

/** Stored on profiles by `id`, so an id must never be renamed or reused for a different work. */
export const AVATARS = [
  {
    id: "vermeer",
    group: "Portraits",
    title: "Girl with a Pearl Earring",
    artist: "Johannes Vermeer",
    date: "c. 1665",
  },
  { id: "rembrandt", group: "Portraits", title: "Self-Portrait", artist: "Rembrandt", date: "1660" },
  { id: "van-gogh", group: "Portraits", title: "Self-Portrait", artist: "Vincent van Gogh", date: "1887" },
  { id: "pareja", group: "Portraits", title: "Juan de Pareja", artist: "Diego Velázquez", date: "1650" },
  {
    id: "fayum",
    group: "Portraits",
    title: "Portrait of a young woman in red",
    artist: "Roman Egypt",
    date: "90–120 CE",
  },
  {
    id: "sharaku",
    group: "Portraits",
    title: "Ōtani Oniji III as Yakko Edobei",
    artist: "Tōshūsai Sharaku",
    date: "1794",
  },
  { id: "vigee", group: "Portraits", title: "Madame Grand", artist: "Élisabeth Vigée Le Brun", date: "1783" },
  { id: "modigliani", group: "Portraits", title: "Jeanne Hébuterne", artist: "Amedeo Modigliani", date: "1919" },
  {
    id: "zhanyinbao",
    group: "Portraits",
    title: "Portrait of the imperial guard Zhanyinbao",
    artist: "Qing court artist",
    date: "1760",
  },
  { id: "mona-lisa", group: "Portraits", title: "Mona Lisa", artist: "Leonardo da Vinci", date: "c. 1503–19" },
  { id: "madame-x", group: "Portraits", title: "Madame X", artist: "John Singer Sargent", date: "1883–84" },
  {
    id: "utamaro",
    group: "Portraits",
    title: "Two Ladies with a Lacquered Mirror",
    artist: "Kitagawa Utamaro",
    date: "1790s",
  },
  { id: "starry-night", group: "Landscapes", title: "The Starry Night", artist: "Vincent van Gogh", date: "1889" },
  { id: "water-lilies", group: "Landscapes", title: "Water Lilies", artist: "Claude Monet", date: "1906" },
  {
    id: "great-wave",
    group: "Landscapes",
    title: "The Great Wave off Kanagawa",
    artist: "Katsushika Hokusai",
    date: "1830/33",
  },
  {
    id: "wheat-cypresses",
    group: "Landscapes",
    title: "Wheat Field with Cypresses",
    artist: "Vincent van Gogh",
    date: "1889",
  },
  {
    id: "stacks-of-wheat",
    group: "Landscapes",
    title: "Stacks of Wheat (End of Summer)",
    artist: "Claude Monet",
    date: "1890–91",
  },
  {
    id: "paris-street",
    group: "Landscapes",
    title: "Paris Street; Rainy Day",
    artist: "Gustave Caillebotte",
    date: "1877",
  },
  {
    id: "grande-jatte",
    group: "Landscapes",
    title: "A Sunday on La Grande Jatte",
    artist: "Georges Seurat",
    date: "1884–86",
  },
  {
    id: "hunters-snow",
    group: "Landscapes",
    title: "Hunters in the Snow",
    artist: "Pieter Bruegel the Elder",
    date: "1565",
  },
  { id: "sunflowers", group: "Still lifes", title: "Sunflowers", artist: "Vincent van Gogh", date: "1888" },
  { id: "irises", group: "Still lifes", title: "Irises", artist: "Vincent van Gogh", date: "1890" },
  {
    id: "basket-of-apples",
    group: "Still lifes",
    title: "The Basket of Apples",
    artist: "Paul Cézanne",
    date: "c. 1893",
  },
  {
    id: "van-gogh-fruit",
    group: "Still lifes",
    title: "Grapes, Lemons, Pears, and Apples",
    artist: "Vincent van Gogh",
    date: "1887",
  },
  { id: "redon-flowers", group: "Still lifes", title: "Still Life with Flowers", artist: "Odilon Redon", date: "1905" },
  { id: "peonies", group: "Still lifes", title: "Peonies", artist: "Édouard Manet", date: "1864–65" },
  {
    id: "zurbaran-bowl",
    group: "Still lifes",
    title: "Flowers and Fruit in a Porcelain Bowl",
    artist: "Juan de Zurbarán",
    date: "c. 1645",
  },
  {
    id: "cotan",
    group: "Still lifes",
    title: "Quince, Cabbage, Melon, and Cucumber",
    artist: "Juan Sánchez Cotán",
    date: "c. 1602",
  },
  {
    id: "kandinsky-30",
    group: "Abstract",
    title: "Improvisation No. 30 (Cannons)",
    artist: "Vasily Kandinsky",
    date: "1913",
  },
  {
    id: "kandinsky-green",
    group: "Abstract",
    title: "Painting with Green Center",
    artist: "Vasily Kandinsky",
    date: "1913",
  },
  {
    id: "mondrian",
    group: "Abstract",
    title: "Lozenge Composition with Yellow, Black, Blue, Red, and Gray",
    artist: "Piet Mondrian",
    date: "1921",
  },
  { id: "marc-mill", group: "Abstract", title: "The Bewitched Mill", artist: "Franz Marc", date: "1913" },
  { id: "kandinsky-yrb", group: "Abstract", title: "Yellow-Red-Blue", artist: "Vasily Kandinsky", date: "1925" },
  { id: "malevich", group: "Abstract", title: "Suprematist Composition", artist: "Kazimir Malevich", date: "1916" },
  { id: "delaunay", group: "Abstract", title: "Rhythm, Joy of Life", artist: "Robert Delaunay", date: "1930" },
  { id: "klee", group: "Abstract", title: "Senecio", artist: "Paul Klee", date: "1922" },
] as const satisfies readonly {
  id: string;
  group: (typeof AVATAR_GROUPS)[number];
  title: string;
  artist: string;
  date: string;
}[];

export type Avatar = (typeof AVATARS)[number];
export type AvatarId = Avatar["id"];

export const avatarId = v.union(...AVATARS.map((avatar) => v.literal(avatar.id)));

export function isAvatarId(value: unknown): value is AvatarId {
  return AVATARS.some((avatar) => avatar.id === value);
}

export function findAvatar(id: AvatarId): Avatar {
  return AVATARS.find((avatar) => avatar.id === id)!;
}

/** The painting someone sees until they choose a picture; `seed` must stay stable for that person. */
export function defaultAvatar(seed: string): AvatarId {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  // FNV-1a alone sends IDs that differ in their last characters to neighbouring presets; this spreads them out.
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  hash ^= hash >>> 16;
  return AVATARS[(hash >>> 0) % AVATARS.length].id;
}
