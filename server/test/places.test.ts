import { expect, test } from "vitest";
import { placeOf } from "../src/places";

// Owner, 11 Nov 2026: "people's full home addresses, really?"; "how can there be two Johannesburgs ... group properly". Every location found on the live
// board that morning, each as a town (never a street, a number or a postal code) and one city name.
test("an address becomes a town and its city; one city has one name however it is written", () => {
  const cases: [string, string, string][] = [
    ["35 Monterrey, 15 Capricorn Drive, Lonehill, Sandton, 2062", "Lonehill", "Johannesburg"],
    ["132 Cnr King and Prince Street, Tirong, Kya Sands 2169", "Kya Sands", "Johannesburg"],
    ["Robyn Avenue, Naturena, 2095, Johannesburg, Gauteng, South Africa", "Naturena", "Johannesburg"],
    ["Corner Maxwell and Pretoria main Rd, Waterfall City 2090", "Waterfall City", "Johannesburg"],
    ["93 Palm Road, Chatsworth, 4092", "Chatsworth", "Durban"],
    ["Gardens Cape Town 8001", "Cape Town", "Cape Town"],
    ["Benoni, 1501, South Africa", "Benoni", "Ekurhuleni (East Rand)"],
    ["Johannesburg, Gauteng", "Johannesburg", "Johannesburg"], ["Johannesburg, South Africa", "Johannesburg", "Johannesburg"], ["Johannesburg, ZAR", "Johannesburg", "Johannesburg"],
    ["JHB", "Johannesburg", "Johannesburg"], ["Halfway House, Midrand", "Halfway House", "Johannesburg"], ["Roodepoort, Johannesburg", "Roodepoort", "Johannesburg"],
    ["Pretoria, Gauteng", "Pretoria", "Pretoria"], ["Sandton, Johannesburg (hybrid)", "Sandton", "Johannesburg"], ["Gqeberha", "Gqeberha", "Gqeberha"], ["Port Elizabeth", "Port Elizabeth", "Gqeberha"],
    ["Westrand", "Westrand", "West Rand"], ["Polokwane", "Polokwane", "Polokwane"], ["", "", ""],
  ];
  for (const [raw, town, city] of cases) expect(placeOf(raw), raw).toEqual({ town, city });
});

test("a place not on the list stays as its own town and city, cleaned of street and numbers", () => {
  expect(placeOf("12 Main Street, Ggeberha, 6001")).toEqual({ town: "Ggeberha", city: "Ggeberha" });
});

test("a province, alone or as a region, is the place only when nothing smaller is named (owner, 11 Nov 2026: \"Gauteng territory\")", () => {
  expect(placeOf("Gauteng territory")).toEqual({ town: "Gauteng", city: "Gauteng" });
  expect(placeOf("Western Cape region")).toEqual({ town: "Western Cape", city: "Western Cape" });
  expect(placeOf("KZN")).toEqual({ town: "KwaZulu-Natal", city: "KwaZulu-Natal" });
  expect(placeOf("Gauteng-based")).toEqual({ town: "Gauteng", city: "Gauteng" });
  expect(placeOf("Johannesburg, Gauteng territory")).toEqual({ town: "Johannesburg", city: "Johannesburg" });
  expect(placeOf("Sandton, Gauteng, South Africa")).toEqual({ town: "Sandton", city: "Johannesburg" });
});

test("a place cut short by a line break is not a known place; the whole name is", async () => {
  const { knownPlace } = await import("../src/places");
  expect(knownPlace("Gardens Cape")).toBeNull();
  expect(knownPlace("Gardens Cape Town")).toEqual({ town: "Cape Town", city: "Cape Town" });
  expect(knownPlace("Gauteng")).toEqual({ town: "Gauteng", city: "Gauteng" });
});
