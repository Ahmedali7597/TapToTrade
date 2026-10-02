import { buildCityCountsQuery, buildSearchQuery, escapeLike, PAGE_SIZE, parseSearchParams } from "./search.js";
import { CITIES } from "../../shared/cities.js";

describe("search filters (4.4.1–4.4.4)", () => {
  test("defaults are safe", () => {
    expect(parseSearchParams({})).toEqual({ name: "", city: null, radius: null, minQty: 1, condition: null, finish: null, sort: "name", page: 1 });
  });

  test("keeps valid filters", () => {
    expect(parseSearchParams({ name: " Lightning Bolt ", city: "Hamilton, ON", radius: "25", minQty: "3", condition: "NM", finish: "foil", sort: "quantity", page: "2" })).toEqual({
      name: "Lightning Bolt",
      city: "Hamilton, ON",
      radius: 25,
      minQty: 3,
      condition: "NM",
      finish: "foil",
      sort: "quantity",
      page: 2,
    });
  });

  test("drops unknown or malicious values", () => {
    const f = parseSearchParams({ city: "Atlantis", radius: "50", minQty: "-2", condition: "mint", finish: "shiny", sort: "name; DROP TABLE users", page: "-4" });
    expect(f).toMatchObject({ city: null, radius: null, minQty: 1, condition: null, finish: null, sort: "name", page: 1 });
    // Only the offered distances are accepted, and only around a real city.
    expect(parseSearchParams({ city: "Hamilton, ON", radius: "37" }).radius).toBeNull();
  });

  test("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
  });
});

describe("search SQL (5.1.2)", () => {
  test("ST-01 user input only ever travels as parameters", () => {
    const evil = "'; DROP TABLE users;--";
    const { sql, params } = buildSearchQuery(parseSearchParams({ name: evil, page: "3" }), 42);
    expect(sql).not.toContain("DROP");
    expect(params).toEqual([evil, null, 1, null, 42, null, 2 * PAGE_SIZE]);
  });

  test("a radius turns the city filter into every listed city within that distance", () => {
    const exact = buildSearchQuery(parseSearchParams({ city: "Hamilton, ON" }), 1).params[1];
    expect(exact).toEqual(["Hamilton, ON"]);
    const near = buildSearchQuery(parseSearchParams({ city: "Hamilton, ON", radius: "25" }), 1).params[1];
    expect(near).toEqual(expect.arrayContaining(["Hamilton, ON", "Burlington, ON", "Stoney Creek, ON"]));
    expect(near).not.toContain("Toronto, ON"); // about 60 km away
  });

  test("nearest-first sort orders by distance from the searched city, or the viewer's own", () => {
    const own = buildSearchQuery(parseSearchParams({ sort: "distance" }), 1, "Ottawa, ON");
    expect(own.sql).toContain("array_position($8::text[], u.city)");
    expect(own.params[7][0]).toBe("Ottawa, ON");
    expect(own.params[7]).toHaveLength(CITIES.length); // every listed city, nearest first
    expect(buildSearchQuery(parseSearchParams({ sort: "distance", city: "Halifax, NS" }), 1, "Ottawa, ON").params[7][0]).toBe("Halifax, NS");
    // Other sorts don't send $8 (Postgres rejects unused parameters).
    expect(buildSearchQuery(parseSearchParams({ sort: "name" }), 1).params).toHaveLength(7);
  });

  test("the map's per-city counts use the same filters without paging", () => {
    const { sql, params } = buildCityCountsQuery(parseSearchParams({ name: "bolt", city: "Hamilton, ON", radius: "10", page: "4" }), 9);
    expect(sql).toMatch(/GROUP BY u\.city$/);
    expect(sql).not.toMatch(/LIMIT|OFFSET/);
    expect(params).toEqual(["bolt", expect.arrayContaining(["Hamilton, ON"]), 1, null, 9, null]);
  });

  test("every sort ends with a unique key so paging is deterministic", () => {
    for (const sort of ["name", "quantity", "newest"]) {
      const { sql } = buildSearchQuery(parseSearchParams({ sort }), 1);
      expect(sql).toMatch(/i\.id (ASC|DESC)\s+LIMIT/);
    }
  });
});
