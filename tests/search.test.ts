import { test } from "node:test";
import assert from "node:assert/strict";
import { searchBuildings } from "../shared/search";
import { Store, Conflict } from "../server/store";
import { importPlan } from "../server/import";
import { buildingSchema } from "../shared/model";

function fixture() {
  const store = new Store(":memory:");
  store.saveBuilding({
    name: "AMLI Mark24",
    address: "2428 NW Market St., Seattle WA 98107",
    aliases: ["Mark24", "Mark 24", "AMLI Mark 24"],
  });
  store.saveBuilding({
    name: "Quiet Court",
    address: "100 Elm Street",
    aliases: ["Court House"],
    manual_status_override: "REJECTED",
    rejection_reason: "No in-unit washer/dryer",
    notes: "Reviewed previously.",
  });
  return store;
}
test("exact building name match and case-insensitive match", () => {
  const store = fixture();
  try {
    assert.deepEqual(
      searchBuildings(store.buildings(), "AMLI Mark24").map((b) => b.name),
      ["AMLI Mark24"],
    );
    assert.equal(
      searchBuildings(store.buildings(), "  aMlI mArK24  ")[0].name,
      "AMLI Mark24",
    );
  } finally {
    store.db.close();
  }
});
test("exact and partial aliases, partial names, spacing variants and small typos", () => {
  const store = fixture();
  try {
    for (const query of [
      "Mark 24",
      "mark24",
      "AMLI Mark",
      "Mark",
      "AMLI Mark 24",
      "Mark25",
    ])
      assert.equal(
        searchBuildings(store.buildings(), query)[0].name,
        "AMLI Mark24",
      );
    assert.equal(
      searchBuildings(store.buildings(), "court house")[0].name,
      "Quiet Court",
    );
  } finally {
    store.db.close();
  }
});
test("match priority: exact name, exact alias, name prefix, partial name, address", () => {
  const store = new Store(":memory:");
  try {
    for (const [name, aliases, address] of [
      ["Address only", [], "5 Market Street"],
      ["The Market Building", [], "4 Elm St"],
      ["Market Square", [], "3 Elm St"],
      ["Alias building", ["Market"], "2 Elm St"],
      ["Market", [], "1 Elm St"],
    ] as [string, string[], string][])
      store.saveBuilding({ name, aliases, address });
    assert.deepEqual(
      searchBuildings(store.buildings(), "market").map((b) => b.name),
      [
        "Market",
        "Alias building",
        "Market Square",
        "The Market Building",
        "Address only",
      ],
    );
  } finally {
    store.db.close();
  }
});
test("raw and normalized address partial matches", () => {
  const store = fixture();
  try {
    for (const query of [
      "2428 NW",
      "2428 Northwest Market Street",
      "market st",
      "SEATTLE WA 98107",
    ])
      assert.equal(
        searchBuildings(store.buildings(), query)[0].name,
        "AMLI Mark24",
      );
  } finally {
    store.db.close();
  }
});
test("rejected buildings remain searchable with their previous review", () => {
  const store = fixture();
  try {
    const match = searchBuildings(store.snapshot().buildings, "Court House")[0];
    assert.equal(match.final_status, "REJECTED");
    assert.equal(match.rejection_reason, "No in-unit washer/dryer");
    assert.equal(match.notes, "Reviewed previously.");
    assert(match.last_reviewed_date);
  } finally {
    store.db.close();
  }
});
test("no match and empty query return an empty list", () => {
  const store = fixture();
  try {
    for (const query of ["unrelated property", "", "   ", "!!!"])
      assert.deepEqual(searchBuildings(store.buildings(), query), []);
  } finally {
    store.db.close();
  }
});
test("aliases are persisted, cleaned, portable, and never used as duplicate keys", () => {
  const store = fixture(),
    destination = new Store(":memory:");
  try {
    const b = store.buildings()[0];
    store.saveBuilding(
      { ...b, aliases: [" New alias ", "new ALIAS", "", "Other"] },
      b.id,
    );
    assert.deepEqual(store.buildings()[0].aliases, ["New alias", "Other"]);
    store.saveBuilding({
      name: "Same alias, different building",
      address: "999 Other Road",
      aliases: ["New alias"],
    });
    assert.equal(searchBuildings(store.buildings(), "New alias").length, 2);
    assert.throws(
      () =>
        store.saveBuilding({
          ...b,
          aliases: ["Different"],
          address: "2428 NW Market Street Seattle WA 98107",
        }),
      Conflict,
    );
    destination.transaction(() =>
      importPlan(destination, store.export(), true),
    );
    assert.deepEqual(destination.buildings()[0].aliases, [
      "New alias",
      "Other",
    ]);
    const legacy = { ...store.buildings()[0] } as any;
    delete legacy.aliases;
    store.db
      .prepare("UPDATE buildings SET data=? WHERE id=?")
      .run(JSON.stringify(legacy), legacy.id);
    assert.deepEqual(store.buildings()[0].aliases, []);
    assert.deepEqual(
      buildingSchema.parse({ name: "Legacy", address: "100 Road" }).aliases,
      [],
    );
  } finally {
    store.db.close();
    destination.db.close();
  }
});
