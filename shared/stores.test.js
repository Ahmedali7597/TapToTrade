import { directionsUrl, slugify, storeIdFromSlug, storePath, tagLabel } from "./stores.js";

test("store links are readable, and only the number identifies the store", () => {
  expect(slugify("Snapcaster's Games & Café")).toBe("snapcasters-games-cafe");
  expect(storePath({ id: 12, name: "Snapcaster's Games & Café" })).toBe("/stores/12-snapcasters-games-cafe");
  expect(storePath({ id: 3, name: "!!!" })).toBe("/stores/3");
  expect(storeIdFromSlug("12-old-name")).toBe(12);
  expect(storeIdFromSlug("12")).toBe(12);
  expect(storeIdFromSlug("abc")).toBeNull();
  expect(storeIdFromSlug("12-Bad Slug")).toBeNull();
});

test("tags have friendly labels and directions open Google Maps", () => {
  expect(tagLabel("trade_night")).toBe("Trade night");
  expect(tagLabel("unknown")).toBe("unknown");
  expect(directionsUrl({ name: "The Mana Vault", address: "1 King St W", city: "Hamilton, ON" })).toBe(
    "https://www.google.com/maps/dir/?api=1&destination=The%20Mana%20Vault%2C%201%20King%20St%20W%2C%20Hamilton%2C%20ON",
  );
});
