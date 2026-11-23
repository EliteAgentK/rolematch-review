import { expect, test } from "vitest";
import { withoutGluedStart as f } from "../src/docmodel/identity";

// X3: a label or a town joined to an address by OCR. Counterexamples first, since a wrong change here edits someone's real address.
test("a label or a town before the person's own name is removed", () => {
  expect(f("emailsiphokazinkomo.cv0597@candidate.example", ["siphokazi", "nkomo"])).toBe("siphokazinkomo.cv0597@candidate.example");
  expect(f("rustenburgreabetswemodiba.cv0604@candidate.example", ["reabetswe", "modiba"])).toBe("reabetswemodiba.cv0604@candidate.example");
  expect(f("gqeberhanonhlanhlaoetober.cv0835@candidate.example", ["nonhlanhla", "october"])).toBe("nonhlanhlaoetober.cv0835@candidate.example");
});
test("what is really the address is left alone", () => {
  expect(f("thandi.mokoena@gmail.com", ["thandi", "mokoena"])).toBe("thandi.mokoena@gmail.com");
  expect(f("durbanjobs@company.co.za", ["thandi", "mokoena"])).toBe("durbanjobs@company.co.za");       // no name after the town
  expect(f("durbanthandi@gmail.com", [])).toBe("durbanthandi@gmail.com");                               // no name known
  expect(f("capetownthandi@gmail.com", ["capetown", "thandi"])).toBe("capetownthandi@gmail.com");       // the start is part of the name
  expect(f("mail@company.co.za", ["thandi"])).toBe("mail@company.co.za");
});
