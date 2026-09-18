import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import { createApp } from "../server/index";
import { rankBuildings } from "../shared/engine";

const unitInput = {
  unit_number: "247",
  sqft: 650,
  base_rent: 2100,
  parking_cost: 100,
  mandatory_monthly_fees: 40,
  available_date: "2026-10-28",
  lease_length_months: 12,
};
async function withInventory(run: (context: any) => Promise<void>) {
  const store = new Store(":memory:");
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const request = async (
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result;
  };
  try {
    const created = await request("/apartment", {
      building: {
        name: "Windsor Ballard",
        address: "100 Test Street",
        quiet_score: 8,
        safety_score: 8,
        commute_score: 8,
        building_quality_score: 8,
        parking_type: "garage",
        has_in_unit_washer_dryer: "yes",
      },
      unit: unitInput,
    });
    await run({
      store,
      request,
      id: created.building_id,
      first: created.unit,
      add: (patch: any) =>
        request("/apartment", {
          building_id: created.building_id,
          unit: { ...unitInput, ...patch },
        }),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.db.close();
  }
}
test("one permanent building contains multiple distinct units", async () =>
  withInventory(async ({ store, id, add }) => {
    await add({ unit_number: "322" });
    await add({ unit_number: "518" });
    assert.equal(store.buildings().length, 1);
    assert.equal(store.units().length, 3);
    assert(store.units().every((unit: any) => unit.building_id === id));
    assert.deepEqual(
      store.units().map((unit: any) => unit.unit_number),
      ["247", "322", "518"],
    );
  }));
test("adding a second unit without building fields preserves existing building facts", async () =>
  withInventory(async ({ store, add }) => {
    const before = store.buildings()[0];
    await add({ unit_number: "322" });
    const after = store.buildings()[0];
    assert.equal(store.buildings().length, 1);
    assert.deepEqual(
      {
        ...after,
        last_updated: before.last_updated,
        last_reviewed_date: before.last_reviewed_date,
      },
      before,
    );
  }));
test("best qualifying unit drives the opportunity score", async () =>
  withInventory(async ({ store, add }) => {
    const second = await add({ unit_number: "322", base_rent: 1800 });
    const building = store.snapshot().buildings[0];
    assert.equal(building.best_unit?.id, second.unit.id);
    assert.equal(
      building.opportunity_score,
      building.units.find((u: any) => u.id === second.unit.id).unit_score,
    );
  }));
test("unavailable unit cannot prevent another qualifying unit making a building SHORTLIST", async () =>
  withInventory(async ({ store, request, first, add }) => {
    await request(
      "/units/" + first.id,
      { ...first, available_date: "2026-09-20" },
      "PUT",
    );
    assert.equal(store.snapshot().buildings[0].auto_status, "WATCH");
    const qualifying = await add({ unit_number: "322" });
    const b = store.snapshot().buildings[0];
    assert.equal(b.auto_status, "SHORTLIST");
    assert.equal(b.best_unit?.id, qualifying.unit.id);
  }));
test("inactive units do not drive best-unit choice or ranking, and can be restored", async () =>
  withInventory(async ({ store, request, first, add }) => {
    const second = await add({ unit_number: "322", base_rent: 1800 });
    const before = store.snapshot().buildings[0];
    await request(
      "/units/" + second.unit.id,
      { ...second.unit, active: false },
      "PUT",
    );
    const inactive = store.snapshot().buildings[0];
    assert.equal(inactive.best_unit?.id, first.id);
    assert(inactive.opportunity_score < before.opportunity_score);
    const competitor = {
      ...inactive,
      id: "competitor",
      name: "Competitor",
      opportunity_score:
        (inactive.opportunity_score + before.opportunity_score) / 2,
    };
    assert.equal(rankBuildings([before, competitor])[0].id, before.id);
    assert.equal(rankBuildings([inactive, competitor])[0].id, "competitor");
    await request("/units/" + first.id, { ...first, active: false }, "PUT");
    assert.equal(store.snapshot().buildings[0].auto_status, "WATCH");
    assert.equal(store.units().length, 2);
    await request(
      "/units/" + second.unit.id,
      { ...second.unit, active: true },
      "PUT",
    );
    assert.equal(store.snapshot().buildings[0].best_unit?.id, second.unit.id);
  }));
test("editing a unit preserves its identity and history without modifying its sibling", async () =>
  withInventory(async ({ store, request, first, add }) => {
    const second = await add({ unit_number: "322" });
    const sibling = store.units().find((u: any) => u.id === second.unit.id);
    const updated = await request(
      "/units/" + first.id,
      { ...first, base_rent: 2000, available_date: "2026-11-01" },
      "PUT",
    );
    assert.equal(updated.id, first.id);
    assert.equal(updated.first_seen_date, first.first_seen_date);
    assert.equal(store.units().length, 2);
    assert.deepEqual(
      store.units().find((u: any) => u.id === second.unit.id),
      sibling,
    );
    assert(
      store
        .history()
        .some(
          (h: any) =>
            h.unit_id === first.id &&
            h.before?.base_rent === 2100 &&
            h.after?.base_rent === 2000,
        ),
    );
  }));
test("editing permanent building facts does not modify units or override decisions", async () =>
  withInventory(async ({ store, request, id, add }) => {
    await add({ unit_number: "322" });
    const units = store.units();
    const building = store.buildings()[0];
    await request(
      "/buildings/" + id,
      {
        ...building,
        manual_status_override: "REJECTED",
        rejection_reason: "Tour concern",
      },
      "PUT",
    );
    await request(
      "/buildings/" + id,
      {
        ...store.buildings()[0],
        notes: "Updated permanent facts",
        quiet_score: 9,
      },
      "PUT",
    );
    assert.deepEqual(store.units(), units);
    assert.equal(store.snapshot().buildings[0].final_status, "REJECTED");
  }));
