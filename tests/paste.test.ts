import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { planPaste, savePaste, parseApartmentJSON } from "../server/paste";
import { createApp } from "../server/index";

const building = {
  name: "Windsor Ballard",
  address: "5555 14th Ave NW, Seattle, WA 98107",
  quiet_score: 6,
  safety_score: 8,
  commute_score: 7,
  building_quality_score: 8,
  parking_type: "garage",
  has_in_unit_washer_dryer: "yes",
  notes: "Original building review.",
};
const unit = {
  unit_number: "247",
  sqft: 654,
  base_rent: 2174,
  parking_cost: 115,
  mandatory_monthly_fees: 91,
  available_date: "2026-10-31",
  lease_length_months: 12,
  notes: "Original unit review.",
};
const payload = (data: unknown, extra: any = {}) => ({
  text: JSON.stringify(data),
  ...extra,
});
function apply(store: Store, data: unknown, extra: any = {}) {
  const request = payload(data, extra);
  const plan = planPaste(store, request);
  return { plan, ...savePaste(store, { ...request, token: plan.token }) };
}
function fixture() {
  const store = new Store(":memory:");
  const b = store.saveBuilding(building);
  const u = store.saveUnit({ ...unit, building_id: b.id });
  return { store, b, u };
}

test("paste new building and one unit previews without writing then saves", () => {
  const store = new Store(":memory:");
  try {
    const request = payload({ building, units: [unit] });
    const plan = planPaste(store, request);
    assert.equal(store.buildings().length, 0);
    assert.equal(plan.units[0].classification, "NEW UNIT");
    assert.equal(plan.evaluation.auto_status, "SHORTLIST");
    assert.equal(plan.rank, 1);
    savePaste(store, { ...request, token: plan.token });
    assert.equal(store.buildings().length, 1);
    assert.equal(store.units().length, 1);
  } finally {
    store.db.close();
  }
});
test("paste multiple units creates exactly one building; zero units is valid", () => {
  const store = new Store(":memory:");
  try {
    const result = apply(store, {
      building,
      units: [
        unit,
        { ...unit, unit_number: "322" },
        { ...unit, unit_number: "518" },
      ],
    });
    assert.equal(store.buildings().length, 1);
    assert.equal(store.units().length, 3);
    assert(store.units().every((u) => u.building_id === result.building_id));
    apply(store, {
      building: { name: "Empty building", address: "999 Other Street" },
      units: [],
    });
    assert.equal(store.buildings().length, 2);
  } finally {
    store.db.close();
  }
});
test("existing normalized address adds a new unit and keeps building facts by default", () => {
  const { store, b } = fixture();
  try {
    const result = apply(store, {
      building: {
        ...building,
        name: "Alternate name",
        address: "5555 14th Avenue NW Seattle WA 98107",
        quiet_score: 9,
      },
      units: [{ ...unit, unit_number: "322" }],
    });
    assert.equal(result.building_id, b.id);
    assert.equal(result.plan.existing?.id, b.id);
    assert.equal(store.buildings().length, 1);
    assert.equal(store.units().length, 2);
    assert.equal(store.buildings()[0].name, building.name);
    assert.equal(store.buildings()[0].quiet_score, 6);
  } finally {
    store.db.close();
  }
});
test("existing unit updates with an explicit diff and preserved identity", () => {
  const { store, b, u } = fixture();
  try {
    const result = apply(
      store,
      {
        units: [
          {
            unit_number: "Unit #247",
            base_rent: 2099,
            available_date: "2026-11-01",
          },
        ],
      },
      { building_id: b.id },
    );
    assert.equal(result.plan.units[0].classification, "EXISTING UNIT");
    assert.deepEqual(
      result.plan.units[0].changes.find((c) => c.field === "base_rent"),
      { field: "base_rent", before: 2174, after: 2099 },
    );
    assert.equal(store.units().length, 1);
    assert.equal(store.units()[0].id, u.id);
    assert.equal(store.units()[0].sqft, 654);
    assert.equal(store.units()[0].first_seen_date, u.first_seen_date);
  } finally {
    store.db.close();
  }
});
test("updated units retain before/after price and availability history", () => {
  const { store, b, u } = fixture();
  try {
    apply(
      store,
      {
        units: [
          { unit_number: "247", base_rent: 2099, available_date: "2026-11-01" },
        ],
      },
      { building_id: b.id },
    );
    assert(
      store
        .history()
        .some(
          (h) =>
            h.unit_id === u.id &&
            h.before?.base_rent === 2174 &&
            h.after?.base_rent === 2099 &&
            h.after?.available_date === "2026-11-01",
        ),
    );
  } finally {
    store.db.close();
  }
});
test("merge preserves manual decisions, appends notes and merges aliases", () => {
  const { store, b } = fixture();
  try {
    store.saveBuilding(
      {
        ...b,
        aliases: ["Windsor"],
        manual_status_override: "REJECTED",
        rejection_reason: "Tour noise",
        toured: true,
        tour_date: "2026-09-15",
        finalist: true,
        signed: true,
      },
      b.id,
    );
    apply(
      store,
      {
        building: {
          name: "New display name",
          notes: "Prefer courtyard.",
          aliases: ["Courtyard"],
        },
        units: [{ unit_number: "247", notes: "New unit note." }],
      },
      { building_id: b.id, mode: "merge" },
    );
    const after = store.buildings()[0];
    assert.equal(after.manual_status_override, "REJECTED");
    assert.equal(after.rejection_reason, "Tour noise");
    assert.equal(after.toured, true);
    assert.equal(after.finalist, true);
    assert.equal(after.signed, true);
    assert.equal(after.tour_date, "2026-09-15");
    assert.equal(after.quiet_score, 6);
    assert.equal(after.notes, "Original building review.\n\nPrefer courtyard.");
    assert.deepEqual(after.aliases, ["Windsor", "Courtyard"]);
    assert.equal(
      store.units()[0].notes,
      "Original unit review.\n\nNew unit note.",
    );
    assert.equal(store.snapshot().buildings[0].final_status, "REJECTED");
  } finally {
    store.db.close();
  }
});
test("invalid JSON syntax reports a useful error with location", () => {
  assert.throws(
    () => parseApartmentJSON('{\n"units": [],\n}'),
    /Invalid JSON.*line/s,
  );
});
test("invalid field values identify the supplied unit and field", () => {
  assert.throws(
    () =>
      parseApartmentJSON(
        JSON.stringify({ building, units: [unit, { ...unit, sqft: "large" }] }),
      ),
    /units\[1\]\.sqft: Expected number, received string/,
  );
  assert.throws(
    () =>
      parseApartmentJSON(
        JSON.stringify({
          building: { ...building, parking_type: "spaceship" },
        }),
      ),
    /building.parking_type/,
  );
});
test("unit-only paste works from building context and is rejected globally", () => {
  const { store, b } = fixture();
  try {
    apply(
      store,
      { units: [{ unit_number: "518", sqft: 702 }] },
      { building_id: b.id },
    );
    assert.equal(store.units().length, 2);
    assert.throws(
      () => planPaste(store, payload({ units: [unit] })),
      /building.name and building.address/,
    );
  } finally {
    store.db.close();
  }
});
test("omitted inventory is not deleted or inactivated and omitted unit fields stay unchanged", () => {
  const { store, b, u } = fixture();
  try {
    const untouched = store.saveUnit({
      ...unit,
      unit_number: "322",
      building_id: b.id,
    });
    apply(
      store,
      { units: [{ unit_number: "247", base_rent: 2000 }] },
      { building_id: b.id },
    );
    assert.deepEqual(
      store.units().find((x) => x.id === untouched.id),
      untouched,
    );
    assert.equal(store.units().find((x) => x.id === u.id)?.active, true);
  } finally {
    store.db.close();
  }
});
test("unknown null numeric fields and optional defaults are accepted", () => {
  const store = new Store(":memory:");
  try {
    apply(store, {
      building: {
        name: "Unknown facts",
        address: "100 Unknown Street",
        quiet_score: null,
        max_floorplan_sqft: null,
      },
      units: [
        {
          sqft: null,
          base_rent: null,
          parking_cost: null,
          mandatory_monthly_fees: null,
          lease_length_months: null,
          floor: null,
          unit_quality_score: null,
        },
      ],
    });
    assert.equal(store.units()[0].sqft, null);
    assert.equal(store.units()[0].active, true);
    assert.equal(store.snapshot().buildings[0].auto_status, "UNREVIEWED");
  } finally {
    store.db.close();
  }
});
test("unnumbered units warn and repeated numbered units are rejected atomically", () => {
  const { store, b } = fixture();
  try {
    const request = payload({ units: [{}, {}] }, { building_id: b.id });
    const plan = planPaste(store, request);
    assert(plan.units.every((u) => u.classification === "UNNUMBERED UNIT"));
    assert.throws(
      () =>
        planPaste(
          store,
          payload(
            { units: [unit, { ...unit, unit_number: "Unit #247" }] },
            { building_id: b.id },
          ),
        ),
      /repeated unit number/,
    );
    assert.equal(store.units().length, 1);
  } finally {
    store.db.close();
  }
});
test("workflow fields and mismatched context addresses cannot be overwritten via paste", () => {
  const { store, b } = fixture();
  try {
    for (const field of [
      "manual_status_override",
      "rejection_reason",
      "toured",
      "tour_date",
      "finalist",
      "signed",
    ])
      assert.throws(
        () =>
          planPaste(
            store,
            payload(
              { building: { [field]: null } },
              { building_id: b.id, mode: "merge" },
            ),
          ),
        /protected workflow field/,
      );
    assert.throws(
      () =>
        planPaste(
          store,
          payload(
            { building: { address: "Different building" } },
            { building_id: b.id },
          ),
        ),
      /does not match this building/,
    );
  } finally {
    store.db.close();
  }
});
test("save requires a fresh preview and rejects repeat submissions", () => {
  const { store, b } = fixture();
  try {
    const request = payload(
      { units: [{ unit_number: "322" }] },
      { building_id: b.id },
    );
    const plan = planPaste(store, request);
    assert.throws(() => savePaste(store, request), /Preview is missing/);
    store.saveBuilding({ ...b, notes: "Changed after preview" }, b.id);
    assert.throws(
      () => savePaste(store, { ...request, token: plan.token }),
      /out of date/,
    );
    assert.equal(store.units().length, 1);
    const current = planPaste(store, request);
    savePaste(store, { ...request, token: current.token });
    assert.throws(
      () => savePaste(store, { ...request, token: current.token }),
      /out of date/,
    );
  } finally {
    store.db.close();
  }
});
test("a failure midway through a batch rolls back building and unit changes", () => {
  const { store, b } = fixture();
  try {
    const request = payload(
      {
        building: { notes: "New note" },
        units: [{ unit_number: "322" }, { unit_number: "518" }],
      },
      { building_id: b.id, mode: "merge" },
    );
    const plan = planPaste(store, request);
    const before = store.export();
    const original = store.saveUnit.bind(store);
    let count = 0;
    store.saveUnit = (...args) => {
      if (++count === 2) throw new Error("simulated write failure");
      return original(...args);
    };
    assert.throws(
      () => savePaste(store, { ...request, token: plan.token }),
      /simulated/,
    );
    assert.deepEqual(store.buildings(), before.buildings);
    assert.deepEqual(store.units(), before.units);
    assert.deepEqual(store.history(), before.history);
  } finally {
    store.db.close();
  }
});
test("HTTP preview/save endpoints enforce validation and preview before mutation", async () => {
  const store = new Store(":memory:");
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/paste/`;
  const post = (path: string, body: any) =>
    fetch(root + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const request = payload({ building, units: [unit] });
    assert.equal((await post("save", request)).status, 409);
    const preview = await (await post("preview", request)).json();
    assert.equal(store.buildings().length, 0);
    assert.equal(
      (await post("save", { ...request, token: preview.token })).status,
      200,
    );
    assert.equal(store.buildings().length, 1);
    const invalid = await post("preview", { text: "{invalid" });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Invalid JSON/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
});
