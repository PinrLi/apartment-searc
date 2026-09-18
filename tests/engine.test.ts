import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, Conflict } from "../server/store";
import { seed } from "../server/seed";
import { importPlan } from "../server/import";
import { defaults, settingsSchema } from "../shared/model";
import { normalizeAddress, normalizeUnit } from "../shared/normalize";
import {
  evaluateBuilding,
  evaluateUnit,
  priceScore,
  leaseScore,
  rankBuildings,
} from "../shared/engine";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function fixture() {
  const store = new Store(":memory:");
  seed(store);
  return store;
}
test("address normalization and unit normalization", () => {
  assert.equal(
    normalizeAddress("2428 NW Market St., Seattle, WA 98107"),
    normalizeAddress("  2428 Northwest Market Street Seattle WA 98107  "),
  );
  assert.equal(normalizeUnit(" Apt. #608 "), "608");
  assert.notEqual(normalizeAddress("10 A St"), normalizeAddress("100 A St"));
});
test("unique address and numbered units; unknown numbers allowed", () => {
  const s = fixture();
  try {
    const b = s.buildings()[0];
    assert.throws(
      () =>
        s.saveBuilding({
          ...b,
          address: "2428 NW Market Street Seattle WA 98107",
        }),
      Conflict,
    );
    assert.throws(
      () => s.saveUnit({ ...s.units()[0], unit_number: "Unit #608" }),
      Conflict,
    );
    s.saveUnit({ ...s.units()[0], unit_number: "" });
    s.saveUnit({ ...s.units()[0], unit_number: "" });
    assert.equal(s.units().length, 6);
    assert.throws(() => s.saveBuilding({ ...b, address: "!!!" }));
  } finally {
    s.db.close();
  }
});
test("AMLI cost, margin, pass, shortlist and 18 month penalty", () => {
  const s = fixture();
  try {
    const b = s.snapshot().buildings[0],
      u = b.units[0];
    assert.equal(u.base_plus_parking, 2261);
    assert.equal(u.budget_margin, 139);
    assert.equal(u.total_mandatory_monthly_cost, 2306);
    assert.equal(u.passes_hard_filters, true);
    assert.equal(b.auto_status, "SHORTLIST");
    assert.equal(u.components.lease, 60);
    assert.equal(b.best_unit?.id, u.id);
  } finally {
    s.db.close();
  }
});
test("price curve reference points and interpolation", () => {
  for (const [cost, expected] of [
    [2400, 0],
    [2300, 7],
    [2200, 13],
    [2100, 17],
    [2000, 20],
    [1800, 20],
    [2500, 0],
    [2250, 10],
  ])
    assert.equal(priceScore(cost) * 0.2, expected);
});
test("lease scoring boundaries; long leases do not hard fail", () => {
  assert.deepEqual(
    [null, 6, 12, 13, 15, 16, 18, 19].map((m) => leaseScore(m)),
    [50, 100, 100, 85, 85, 60, 60, 30],
  );
  const s = fixture();
  try {
    const b = s.buildings()[0],
      u = s.units()[0];
    assert.equal(
      evaluateUnit(b, { ...u, lease_length_months: 24 }).passes_hard_filters,
      true,
    );
  } finally {
    s.db.close();
  }
});
test("hard filters distinguish permanent building failures and unit failures", () => {
  const s = fixture();
  try {
    const [b, small, laundry, watch, rejected] = s.snapshot().buildings;
    assert.equal(small.auto_status, "REJECTED");
    assert.equal(laundry.auto_status, "REJECTED");
    assert.equal(watch.auto_status, "WATCH");
    assert.equal(rejected.auto_status, "SHORTLIST");
    assert.equal(rejected.final_status, "REJECTED");
    for (const patch of [
      { base_rent: 2215 },
      { sqft: 549 },
      { available_date: "2026-10-19" },
      { available_date: "2026-11-08" },
      { active: false },
    ]) {
      const e = evaluateBuilding(b, [{ ...b.units[0], ...patch }]);
      assert.equal(e.auto_status, "WATCH");
      assert.equal(e.units[0].passes_hard_filters, false);
    }
    for (const date of ["2026-10-20", "2026-11-07"])
      assert.equal(
        evaluateUnit(b, { ...b.units[0], available_date: date })
          .passes_hard_filters,
        true,
      );
    for (const patch of [
      { parking_type: "none" as const },
      { parking_type: "street_only" as const },
      { quiet_score: 5 },
      { safety_score: 5 },
      { has_in_unit_washer_dryer: "no" as const },
    ])
      assert.equal(
        evaluateBuilding({ ...b, ...patch }, b.units).auto_status,
        "REJECTED",
      );
    assert.equal(
      evaluateUnit(b, { ...b.units[0], mandatory_monthly_fees: 999 })
        .passes_hard_filters,
      true,
    );
  } finally {
    s.db.close();
  }
});
test("unknown required facts are unresolved; optional fees do not block", () => {
  const s = fixture();
  try {
    const b = s.buildings()[0],
      u = s.units()[0];
    assert.equal(
      evaluateBuilding({ ...b, parking_type: "unknown" }, [u]).auto_status,
      "UNREVIEWED",
    );
    assert.equal(
      evaluateUnit(b, { ...u, parking_cost: null }).passes_hard_filters,
      false,
    );
    assert.equal(
      evaluateUnit(b, { ...u, mandatory_monthly_fees: null })
        .passes_hard_filters,
      true,
    );
  } finally {
    s.db.close();
  }
});
test("manual override persists through changed inventory/settings; clear restores auto", () => {
  const s = fixture();
  try {
    const b = s.buildings()[4];
    s.saveSettings({ ...defaults, min_quiet: 7 });
    s.saveUnit({ ...s.units()[3], base_rent: 1800 }, s.units()[3].id);
    assert.equal(s.snapshot().buildings[4].final_status, "REJECTED");
    s.saveBuilding({ ...b, manual_status_override: null }, b.id);
    assert.equal(s.snapshot().buildings[4].final_status, "SHORTLIST");
    assert(s.history().some((h) => h.after?.rejection_reason));
  } finally {
    s.db.close();
  }
});
test("ranking workflow versus pure score excludes rejected and signed", () => {
  const s = fixture();
  try {
    const b = s.snapshot().buildings[0];
    const list = [
      {
        ...b,
        id: "1",
        name: "Watch",
        final_status: "WATCH" as const,
        opportunity_score: 99,
      },
      {
        ...b,
        id: "2",
        name: "Tour",
        final_status: "TOUR" as const,
        opportunity_score: 50,
      },
      {
        ...b,
        id: "3",
        name: "Finalist",
        final_status: "FINALIST" as const,
        opportunity_score: 40,
      },
      { ...b, id: "4", final_status: "REJECTED" as const },
      { ...b, id: "5", final_status: "SIGNED" as const },
    ];
    assert.deepEqual(
      rankBuildings(list).map((b) => b.id),
      ["3", "2", "1"],
    );
    assert.deepEqual(
      rankBuildings(list, true).map((b) => b.id),
      ["1", "2", "3"],
    );
  } finally {
    s.db.close();
  }
});
test("best opportunity uses qualifying active units only", () => {
  const s = fixture();
  try {
    const b = s.buildings()[0],
      u = s.units()[0];
    const e = evaluateBuilding(b, [
      u,
      { ...u, id: "better", base_rent: 1800 },
      { ...u, id: "inactive", base_rent: 1000, active: false },
    ]);
    assert.equal(e.best_unit?.id, "better");
  } finally {
    s.db.close();
  }
});
test("settings reject invalid weights, dates and price curves", () => {
  assert.throws(() =>
    settingsSchema.parse({
      ...defaults,
      weights: { ...defaults.weights, quiet: 30 },
    }),
  );
  assert.throws(() =>
    settingsSchema.parse({ ...defaults, earliest: "2026-02-30" }),
  );
  assert.throws(() =>
    settingsSchema.parse({
      ...defaults,
      price_points: [
        [2000, 0],
        [1900, 100],
      ],
    }),
  );
  assert.throws(() => settingsSchema.parse({ ...defaults, size_cap: 500 }));
});
test("atomic save rolls back a building change when unit conflicts", () => {
  const s = fixture();
  try {
    const b = s.buildings()[0];
    assert.throws(() =>
      s.transaction(() => {
        s.saveBuilding({ ...b, notes: "SHOULD ROLLBACK" }, b.id);
        s.saveUnit(s.units()[0]);
      }),
    );
    assert.notEqual(s.buildings()[0].notes, "SHOULD ROLLBACK");
  } finally {
    s.db.close();
  }
});
test("SQLite persistence survives close and reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "apartment-test-"));
  try {
    let s = new Store(join(dir, "test.sqlite"));
    seed(s);
    const id = s.buildings()[4].id;
    s.db.close();
    s = new Store(join(dir, "test.sqlite"));
    assert.equal(s.buildings().length, 6);
    assert.equal(
      s.snapshot().buildings.find((b) => b.id === id)?.final_status,
      "REJECTED",
    );
    assert(s.history().length > 0);
    s.db.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("JSON import previews, preserves history and is repeatable without duplicates", () => {
  const s = fixture(),
    dest = new Store(":memory:");
  try {
    s.saveUnit({ ...s.units()[0], unit_number: "" });
    const data = s.export();
    const plan = importPlan(dest, data);
    assert.equal(plan.new_buildings, 6);
    assert.equal(dest.buildings().length, 0);
    dest.transaction(() => importPlan(dest, data, true));
    assert.equal(dest.buildings().length, 6);
    assert.equal(dest.units().length, 5);
    const repeat = importPlan(dest, data);
    assert.equal(repeat.new_buildings, 0);
    assert.equal(repeat.new_units, 0);
    assert.equal(repeat.existing_units, 5);
    dest.transaction(() => importPlan(dest, data, true));
    assert.equal(dest.units().length, 5);
    assert(dest.history().some((h) => h.after?.rejection_reason));
  } finally {
    s.db.close();
    dest.db.close();
  }
});
test("invalid import is atomic and existing decisions are not overwritten", () => {
  const s = fixture();
  try {
    const data = s.export();
    data.buildings[4].manual_status_override = null;
    s.transaction(() => importPlan(s, data, true));
    assert.equal(s.buildings()[4].manual_status_override, "REJECTED");
    const before = s.buildings().length;
    assert.throws(() =>
      s.transaction(() =>
        importPlan(
          s,
          { ...data, units: [{ ...data.units[0], building_id: "missing" }] },
          true,
        ),
      ),
    );
    assert.equal(s.buildings().length, before);
  } finally {
    s.db.close();
  }
});
