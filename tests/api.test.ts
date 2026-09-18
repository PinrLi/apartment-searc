import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index";
import { Store } from "../server/store";
import { seed } from "../server/seed";
test("HTTP workflows: preview, duplicate conflicts, update, history, export, delete, local access", async () => {
  const s = new Store(":memory:");
  seed(s);
  const server = createApp(s).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number };
  const root = `http://127.0.0.1:${address.port}/api`;
  const request = (
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
  ) =>
    fetch(root + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const state = await (await request("/state")).json();
    const b = state.buildings[0],
      u = b.units[0];
    const dup = await (
      await request(
        "/duplicate?address=" +
          encodeURIComponent("2428 NW Market Street Seattle WA 98107"),
      )
    ).json();
    assert.equal(dup.id, b.id);
    assert.equal((await request("/apartment", { building: b })).status, 409);
    const added = await (
      await request("/apartment", {
        building: { name: "API entry", address: "777 Test Road" },
        unit: { unit_number: "4", base_rent: 1900, parking_cost: 0, sqft: 600 },
      })
    ).json();
    assert(s.buildings().some((x) => x.id === added.building_id));
    assert(s.units().some((x) => x.building_id === added.building_id));
    for (const manual_status_override of [
      "TOUR",
      "FINALIST",
      "SIGNED",
      "REJECTED",
    ]) {
      const current = s.buildings().find((x) => x.id === added.building_id)!;
      assert.equal(
        (
          await request(
            "/buildings/" + current.id,
            {
              ...current,
              manual_status_override,
              rejection_reason: "Test decision",
            },
            "PUT",
          )
        ).status,
        200,
      );
      assert.equal(
        s.snapshot().buildings.find((x) => x.id === current.id)?.final_status,
        manual_status_override,
      );
    }
    const preview = await (
      await request("/preview", {
        building: b,
        building_id: b.id,
        unit: { ...u, base_rent: 2000 },
        unit_id: u.id,
      })
    ).json();
    assert.equal(preview.evaluation.units.length, 1);
    assert(preview.rank > 0);
    assert.equal(
      (await request("/units/" + u.id, { ...u, base_rent: 2000 }, "PUT"))
        .status,
      200,
    );
    assert(
      s
        .history()
        .some(
          (h) =>
            h.action === "Unit updated" &&
            h.before.base_rent === 2076 &&
            h.after.base_rent === 2000,
        ),
    );
    const json = await (await request("/export/json")).json();
    assert.equal(json.version, 1);
    assert(json.history.length > 0);
    const csv = await (await request("/export/csv")).text();
    assert(csv.includes("base_plus_parking"));
    assert(csv.includes("AMLI Mark24"));
    assert.equal(
      (
        await request(
          "/settings",
          {
            ...state.settings,
            weights: { ...state.settings.weights, quiet: 0 },
          },
          "PUT",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(root + "/state", {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("/units/" + u.id, undefined, "DELETE")).status,
      200,
    );
    assert.equal(
      s.units().some((x) => x.id === u.id),
      false,
    );
    assert.equal(
      (await request("/buildings/" + b.id, undefined, "DELETE")).status,
      200,
    );
    assert(s.history().some((h) => h.action === "Building deleted"));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    s.db.close();
  }
});
