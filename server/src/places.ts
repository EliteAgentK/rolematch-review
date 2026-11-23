// Where a person or a job is, as a town and a city, never an address (owner, 11 Nov 2026: "people's full home addresses, really?"; "how can there be two
// Johannesburgs ... sort out that location list, and from now on group properly"). Configuration, not reading: a fixed list of South African cities,
// each with the places that belong to it, so every record is grouped the same way every time, old records included, with nothing asked of the AI.
// A place not on the list stays as its own town and city; to add one, add it here.
const CITIES: { city: string; places: string[] }[] = [
  { city: "Johannesburg", places: ["Johannesburg", "Joburg", "Jozi", "JHB", "Sandton", "Randburg", "Rosebank", "Fourways", "Midrand", "Waterfall City", "Waterfall", "Halfway House", "Roodepoort", "Soweto", "Bryanston", "Rivonia", "Sunninghill", "Lonehill", "Woodmead", "Parktown", "Melville", "Northcliff", "Braamfontein", "Houghton", "Illovo", "Kya Sands", "Lanseria", "Douglasdale", "Naturena", "Northriding", "Honeydew", "Diepsloot", "Alexandra", "Auckland Park", "Greenside", "Craighall", "Hyde Park", "Dunkeld", "Melrose", "Kyalami", "Paulshof", "Cosmo City", "Weltevreden Park", "Florida", "Constantia Kloof"] },
  { city: "Ekurhuleni (East Rand)", places: ["Ekurhuleni", "East Rand", "Benoni", "Boksburg", "Kempton Park", "Germiston", "Alberton", "Edenvale", "Bedfordview", "Springs", "Brakpan", "Nigel", "Tembisa", "Isando"] },
  { city: "West Rand", places: ["West Rand", "Westrand", "Krugersdorp", "Randfontein", "Mogale City"] },
  { city: "Pretoria", places: ["Pretoria", "Tshwane", "Centurion", "Menlyn", "Hatfield", "Lynnwood", "Irene", "Silverton", "Montana", "Mamelodi", "Soshanguve", "Akasia", "Garsfontein", "Faerie Glen", "Moreleta Park", "Waterkloof", "Arcadia", "Sunnyside"] },
  { city: "Vaal Triangle", places: ["Vereeniging", "Vanderbijlpark", "Vaal", "Sasolburg"] },
  { city: "Cape Town", places: ["Cape Town", "Kaapstad", "Bellville", "Durbanville", "Claremont", "Rondebosch", "Sea Point", "Green Point", "Century City", "Milnerton", "Table View", "Tableview", "Blouberg", "Constantia", "Observatory", "Woodstock", "Tyger Valley", "Tygervalley", "Brackenfell", "Kuils River", "Mitchells Plain", "Khayelitsha", "Somerset West", "Strand", "Gordon's Bay", "Parow", "Goodwood", "Pinelands", "Wynberg", "Plumstead", "Muizenberg", "Fish Hoek", "Hout Bay", "Camps Bay", "Newlands"] },
  { city: "Stellenbosch", places: ["Stellenbosch"] },
  { city: "Paarl", places: ["Paarl", "Wellington", "Franschhoek"] },
  { city: "Durban", places: ["Durban", "eThekwini", "Umhlanga", "Westville", "Pinetown", "Ballito", "Amanzimtoti", "Hillcrest", "Kloof", "Glenwood", "La Lucia", "Umlazi", "Chatsworth", "Phoenix", "Queensburgh"] },
  { city: "Pietermaritzburg", places: ["Pietermaritzburg", "Maritzburg", "PMB"] },
  { city: "Gqeberha", places: ["Gqeberha", "Port Elizabeth", "Nelson Mandela Bay", "Kariega", "Uitenhage", "Summerstrand"] },
  { city: "East London", places: ["East London", "Buffalo City", "Mdantsane"] },
  { city: "Bloemfontein", places: ["Bloemfontein", "Mangaung", "Bloem"] },
  { city: "Polokwane", places: ["Polokwane", "Pietersburg"] },
  { city: "Mbombela", places: ["Mbombela", "Nelspruit", "White River"] },
  { city: "Kimberley", places: ["Kimberley"] },
  { city: "Rustenburg", places: ["Rustenburg"] },
  { city: "Potchefstroom", places: ["Potchefstroom", "Potch"] },
  { city: "Klerksdorp", places: ["Klerksdorp"] },
  { city: "Mahikeng", places: ["Mahikeng", "Mafikeng"] },
  { city: "George", places: ["George"] },
  { city: "Mossel Bay", places: ["Mossel Bay"] },
  { city: "Knysna", places: ["Knysna"] },
  { city: "Hermanus", places: ["Hermanus"] },
  { city: "eMalahleni", places: ["eMalahleni", "Witbank"] },
  { city: "Middelburg", places: ["Middelburg"] },
  { city: "Secunda", places: ["Secunda"] },
  { city: "Richards Bay", places: ["Richards Bay"] },
  { city: "Newcastle", places: ["Newcastle"] },
  { city: "Upington", places: ["Upington"] },
  { city: "Welkom", places: ["Welkom"] },
  { city: "Mthatha", places: ["Mthatha", "Umtata"] },
  { city: "Makhanda", places: ["Makhanda", "Grahamstown"] },
];

const words = (s: string) => ` ${s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()} `;
// Longest names first, so "Port Elizabeth" is found before anything shorter inside it, and a city's own name before its suburbs.
const BY_LENGTH = CITIES.flatMap((c) => c.places.map((p, i) => ({ place: p, city: c.city, own: i === 0 }))).sort((a, b) => b.place.length - a.place.length);
const COUNTRY = /^(south africa|rsa|za|zar|sa)$/i;
// A province, alone or as a region ("Gauteng territory", "Western Cape region", "Gauteng-based"): never a town of its own. Where a location names nothing
// smaller (owner, 11 Nov 2026: a job's location read "Gauteng territory"), the province is the place, written as the province is.
const PROVINCES: [RegExp, string][] = [[/gauteng/, "Gauteng"], [/western cape/, "Western Cape"], [/eastern cape/, "Eastern Cape"], [/northern cape/, "Northern Cape"],
  [/kwazulu natal|kzn/, "KwaZulu-Natal"], [/free state/, "Free State"], [/limpopo/, "Limpopo"], [/mpumalanga/, "Mpumalanga"], [/north west/, "North West"]];
const REGION = /^(?:the )?(gauteng|western cape|eastern cape|northern cape|kwazulu natal|kzn|free state|limpopo|mpumalanga|north west)(?: (?:province|territory|region|area|wide|based))?$/i;
const provinceOf = (part: string) => { const m = words(part).trim().match(REGION); return m ? PROVINCES.find(([re]) => re.test(m[1].toLowerCase()))![1] : ""; };
const STREET = /\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|crescent|cres|close|way|boulevard|blvd|cnr|corner|complex|estate|unit|flat|block|building|plot|farm|erf|stand|po box|private bag|suite)\b/i;
const WORK = /\b(remote|hybrid|on[- ]?site|office[- ]based|in[- ]office|work from home|wfh)\b/i;

/** A location as a town and the city it belongs to. Street names, numbers, postal codes, provinces, the country and work arrangements are left out (a province stands only where nothing smaller is named);
 *  the town is the most precise known place named ("Sandton"), else the first part that is left. An empty or unreadable location gives empty values. */
export function placeOf(raw: unknown): { town: string; city: string } { const { town, city } = readPlace(raw); return { town, city }; }
/** The place, or null when it names nothing on the city list (it stands as written, which may be a place cut short by a line break). */
export function knownPlace(raw: unknown): { town: string; city: string } | null { const p = readPlace(raw); return p.known ? { town: p.town, city: p.city } : null; }

function readPlace(raw: unknown): { town: string; city: string; known: boolean } {
  const text = String(raw ?? "").replace(/\([^)]*\)/g, " ");
  const cleaned = text.split(/[,;|/\n]+/).map((p) => p.replace(/\b\d{3,}\b/g, " ").replace(/\s+/g, " ").trim()).filter((p) => p && !/\d/.test(p) && !STREET.test(p) && !WORK.test(p) && !COUNTRY.test(p));
  const province = cleaned.map(provinceOf).find(Boolean) ?? "", parts = cleaned.filter((p) => !provinceOf(p));
  const all = words(parts.join(" , "));
  const city = BY_LENGTH.find((x) => x.own && all.includes(words(x.place)))?.city ?? BY_LENGTH.find((x) => all.includes(words(x.place)))?.city ?? "";
  // The town: the known place named in the earliest part (the most precise), else that part itself.
  for (const p of parts) { const known = BY_LENGTH.find((x) => words(p).includes(words(x.place))); if (known) return { town: known.place === "JHB" ? "Johannesburg" : known.place, city: city || known.city, known: true }; }
  const town = parts[0] ?? province;
  return { town, city: city || town, known: !!province && !parts.length };
}
