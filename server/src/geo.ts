// PLACES: which city, province and country a location names, worked out on our own servers from a fixed table. No outside mapping or geocoding service
// is called, so a candidate's location never leaves our infrastructure.
//
// Logistics compares places at three levels, as the owner asked: same city, same province, same country (or another country). There is no distance in
// kilometres: whether a commute or a move works is for the recruiter to confirm with the person, and the level is enough to know which question to ask.
//
// Privacy and fairness: towns, cities, business districts, provinces and countries only. Street addresses and postal codes are never looked up (points
// catalogue X13), and a place never moves a score.
//
// THE TABLE IS A STARTER SET entered by hand: the main South African cities, towns and business districts (each with the city it belongs to), the nine
// provinces, and the countries candidates most often name. Extend it from GeoNames (geonames.org, CC BY 4.0, attribution required). A place that is not
// in the table is "unknown", never a guess.

export const PLACES_VERSION = "0.2.0";

type Province = "Gauteng" | "Western Cape" | "KwaZulu-Natal" | "Eastern Cape" | "Free State" | "Limpopo" | "Mpumalanga" | "North West" | "Northern Cape";
const SA = "South Africa";

/** A town, city or business district in South Africa. `city` is the city it belongs to, when it is part of one (Sandton is Johannesburg). */
export interface Place { name: string; province: Province; city?: string; aliases?: string[] }

const P = (province: Province, name: string, more: { city?: string; aliases?: string[] } = {}): Place => ({ name, province, ...more });

export const PLACES: Place[] = [
  P("Gauteng", "Johannesburg", { aliases: ["joburg", "jozi", "johannesburg cbd", "braamfontein"] }),
  ...["Sandton", "Rosebank", "Randburg", "Fourways", "Midrand", "Roodepoort", "Soweto", "Bryanston", "Parktown"].map((n) => P("Gauteng", n, { city: "Johannesburg" })),
  P("Gauteng", "Pretoria", { aliases: ["tshwane", "pretoria cbd"] }),
  ...["Centurion", "Menlyn", "Hatfield", "Irene"].map((n) => P("Gauteng", n, { city: "Pretoria" })),
  P("Gauteng", "Ekurhuleni"),
  ...["Kempton Park", "Germiston", "Boksburg", "Benoni", "Springs", "Alberton", "Edenvale", "Isando"].map((n) => P("Gauteng", n, { city: "Ekurhuleni" })),
  P("Gauteng", "Krugersdorp", { aliases: ["mogale city"] }),
  P("Gauteng", "Vereeniging"), P("Gauteng", "Vanderbijlpark"),
  P("Western Cape", "Cape Town", { aliases: ["cape town cbd", "kaapstad"] }),
  ...["Bellville", "Century City", "Claremont", "Somerset West", "Durbanville", "Tyger Valley", "Woodstock", "Sea Point", "Khayelitsha", "Mitchells Plain"].map((n) => P("Western Cape", n, { city: "Cape Town" })),
  P("Western Cape", "Stellenbosch"), P("Western Cape", "Paarl"), P("Western Cape", "Worcester"), P("Western Cape", "George"), P("Western Cape", "Mossel Bay"),
  P("KwaZulu-Natal", "Durban", { aliases: ["ethekwini", "durban cbd"] }),
  ...["Umhlanga", "Pinetown", "Westville", "Umlazi", "Ballito"].map((n) => P("KwaZulu-Natal", n, { city: "Durban", aliases: n === "Umhlanga" ? ["umhlanga rocks"] : undefined })),
  P("KwaZulu-Natal", "Pietermaritzburg", { aliases: ["msunduzi"] }), P("KwaZulu-Natal", "Richards Bay"), P("KwaZulu-Natal", "Newcastle"),
  P("Eastern Cape", "Gqeberha", { aliases: ["port elizabeth", "nelson mandela bay"] }),
  P("Eastern Cape", "East London", { aliases: ["buffalo city"] }), P("Eastern Cape", "Mthatha", { aliases: ["umtata"] }), P("Eastern Cape", "Makhanda", { aliases: ["grahamstown"] }),
  P("Free State", "Bloemfontein", { aliases: ["mangaung"] }), P("Free State", "Welkom"),
  P("Limpopo", "Polokwane", { aliases: ["pietersburg"] }), P("Limpopo", "Tzaneen"),
  P("Mpumalanga", "Mbombela", { aliases: ["nelspruit"] }), P("Mpumalanga", "eMalahleni", { aliases: ["witbank"] }), P("Mpumalanga", "Middelburg"), P("Mpumalanga", "Secunda"),
  P("North West", "Rustenburg"), P("North West", "Mahikeng", { aliases: ["mafikeng"] }), P("North West", "Potchefstroom"), P("North West", "Klerksdorp"),
  P("Northern Cape", "Kimberley"), P("Northern Cape", "Upington"),
];

const PROVINCES: Record<Province, string[]> = {
  "Gauteng": ["gauteng", "gp"], "Western Cape": ["western cape", "wc"], "KwaZulu-Natal": ["kwazulu natal", "kwazulu-natal", "kzn", "natal"],
  "Eastern Cape": ["eastern cape", "ec"], "Free State": ["free state", "fs"], "Limpopo": ["limpopo"], "Mpumalanga": ["mpumalanga"],
  "North West": ["north west", "north-west", "nw"], "Northern Cape": ["northern cape", "nc"],
};

// Countries by name, with a few capital or major cities that people write on their own ("Gaborone", "London").
const COUNTRIES: Record<string, string[]> = {
  [SA]: ["south africa", "rsa", "za", "suid afrika", "suid-afrika"],
  "Namibia": ["namibia", "windhoek"], "Botswana": ["botswana", "gaborone"], "Zimbabwe": ["zimbabwe", "harare", "bulawayo"], "Zambia": ["zambia", "lusaka"],
  "Mozambique": ["mozambique", "maputo"], "Lesotho": ["lesotho", "maseru"], "Eswatini": ["eswatini", "swaziland", "mbabane"], "Malawi": ["malawi", "lilongwe"],
  "Kenya": ["kenya", "nairobi"], "Nigeria": ["nigeria", "lagos", "abuja"], "Ghana": ["ghana", "accra"], "Egypt": ["egypt", "cairo"], "Mauritius": ["mauritius"],
  "United Kingdom": ["united kingdom", "uk", "england", "scotland", "wales", "london", "manchester"], "Ireland": ["ireland", "dublin"],
  "United States": ["united states", "usa", "us", "new york"], "Canada": ["canada", "toronto"], "Australia": ["australia", "sydney", "melbourne", "perth"],
  "New Zealand": ["new zealand", "auckland"], "United Arab Emirates": ["united arab emirates", "uae", "dubai", "abu dhabi"], "India": ["india", "bangalore", "mumbai"],
  "Germany": ["germany", "berlin"], "Netherlands": ["netherlands", "amsterdam"], "Portugal": ["portugal", "lisbon"],
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
type Hit = { kind: "place"; place: Place } | { kind: "province"; province: Province } | { kind: "country"; country: string };
const NAMES = new Map<string, Hit>();
for (const [country, names] of Object.entries(COUNTRIES)) for (const n of names) NAMES.set(fold(n), { kind: "country", country });
for (const [province, names] of Object.entries(PROVINCES) as [Province, string[]][]) for (const n of names) NAMES.set(fold(n), { kind: "province", province });
for (const p of PLACES) for (const n of [p.name, ...(p.aliases ?? [])]) NAMES.set(fold(n), { kind: "place", place: p }); // a town wins over a same-named country alias

/** Where a location string is, as far as the table can tell. Every level it cannot tell is left out. */
export interface Where { city?: string; province?: Province; country?: string; place?: string }

/**
 * Reads a location such as "Sandton, Johannesburg", "Gauteng", "Durban North, KZN" or "Gaborone, Botswana". Every known name written as whole words is
 * found; the most specific wins (a town, then a province, then a country), the earliest and then the longest where two are equally specific.
 * Short abbreviations (GP, WC, UK, US, ZA) count only as a whole comma-separated part, so "US" in a sentence is not a country.
 */
export function whereIs(location: string): Where {
  const parts = location.split(/[,;/|()]|\s+-\s+/).map(fold).filter(Boolean);
  const text = ` ${fold(location)} `;
  let best: { rank: number; at: number; len: number; hit: Hit } | null = null;
  const rankOf = (h: Hit) => (h.kind === "place" ? 0 : h.kind === "province" ? 1 : 2);
  for (const [name, hit] of NAMES) {
    const at = name.length <= 3 ? (parts.includes(name) ? text.indexOf(` ${name} `) : -1) : text.indexOf(` ${name} `);
    if (at < 0) continue;
    const c = { rank: rankOf(hit), at, len: name.length, hit };
    if (!best || c.rank < best.rank || (c.rank === best.rank && (c.at < best.at || (c.at === best.at && c.len > best.len)))) best = c;
  }
  if (!best) return {};
  const h = best.hit;
  if (h.kind === "place") return { place: h.place.name, city: h.place.city ?? h.place.name, province: h.place.province, country: SA };
  if (h.kind === "province") return { province: h.province, country: SA };
  return { country: h.country };
}

/** True when the text is only a place ("Cape Town", "Sandton, Gauteng", "South Africa"): every comma-separated part is a known name, nothing else. */
export function isPlaceName(text: string): boolean {
  const parts = text.split(/,\s*/).map(fold).filter(Boolean);
  return parts.length > 0 && parts.every((p) => NAMES.has(p));
}

export type PlaceLevel = "same city" | "same province" | "same country" | "different country" | "unknown";

/** How close two places are, by level. Unknown when either side cannot be placed at the level that would decide it. */
export function compareWhere(job: Where, candidate: Where): PlaceLevel {
  if (!job.country || !candidate.country) return "unknown";
  if (job.country !== candidate.country) return "different country";
  if (job.city && candidate.city && job.city === candidate.city) return "same city";
  if (job.province && candidate.province && job.province === candidate.province) return "same province";
  return "same country"; // another province, or one side names only the country so nothing closer can be said
}
