// The approved Artlog demo cohort and its shared publication budget.
export const APPROVED_DEMO_USERNAMES = [
  "alexrivera",
  "amaramensah",
  "beatriceconti",
  "benwhitaker",
  "camillelaurent",
  "celinezhou",
  "devmehta",
  "elenaruiz",
  "emilyfoster",
  "felixweber",
  "gracewilliams",
  "hanakim",
  "hugomartin",
  "imanimorgan",
  "jordanokafor",
  "julesbernard",
  "kenjiito",
  "leahgoldberg",
  "linhnguyen",
  "luciaortega",
  "marcusbell",
  "mateosantos",
  "mayachen",
  "nadiafarouk",
  "noorhaddad",
  "olliehart",
  "priyaraman",
  "rowanprice",
  "samdelgado",
  "sannedevries",
  "sofiabianchi",
  "tomnovak",
] as const;
const approved = new Set<string>(APPROVED_DEMO_USERNAMES);
export const isApprovedDemo = (username: string) => approved.has(username);
export const WEEKLY_LIMITS = { post: 12, comment: 8, like: 16 } as const;
export const WEEK_MS = 7 * 24 * 60 * 60_000;
/** Monday 00:00 UTC, independent of the worker or museum's time zone. */
export const weekStart = (at: number) => Math.floor((at - 4 * 86_400_000) / WEEK_MS) * WEEK_MS + 4 * 86_400_000;
