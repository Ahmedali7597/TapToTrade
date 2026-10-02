import { CITIES, CITY_GROUPS, cityCoords, cityDistance, citiesWithin, nearestCity, PROVINCES } from "./cities.js";

describe("Canada-wide cities and distances", () => {
  test("every province and territory is covered, and every city has coordinates inside Canada", () => {
    expect(CITY_GROUPS.map((g) => g.code).sort()).toEqual(Object.keys(PROVINCES).sort());
    for (const city of CITIES) {
      const [lat, lng] = cityCoords(city);
      expect(lat).toBeGreaterThan(41);
      expect(lat).toBeLessThan(84);
      expect(lng).toBeGreaterThan(-142);
      expect(lng).toBeLessThan(-52);
    }
  });

  test("distances are city centre to city centre, in whole km", () => {
    expect(cityDistance("Hamilton, ON", "Hamilton, ON")).toBe(0);
    expect(cityDistance("Toronto, ON", "Montréal, QC")).toBeGreaterThan(480);
    expect(cityDistance("Toronto, ON", "Montréal, QC")).toBeLessThan(520);
    // Same name, different province: about 1,300 km apart.
    expect(cityDistance("Windsor, ON", "Windsor, NS")).toBeGreaterThan(1200);
    expect(cityDistance("Hamilton, ON", "Atlantis")).toBeNull();
  });

  test("citiesWithin lists the origin first, then nearer cities before farther ones", () => {
    const near = citiesWithin("Vancouver, BC", 25);
    expect(near[0]).toBe("Vancouver, BC");
    expect(near).toEqual(expect.arrayContaining(["Burnaby, BC", "Richmond, BC"]));
    expect(near).not.toContain("Victoria, BC");
    expect(citiesWithin("Atlantis")).toEqual([]);
  });

  test("nearestCity snaps a browser location to the closest listed city", () => {
    expect(nearestCity(43.65, -79.38)).toBe("Toronto, ON"); // downtown Toronto
    expect(nearestCity(46.24, -63.13)).toBe("Charlottetown, PE");
  });
});
