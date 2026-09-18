import { resolve } from "node:path";
import { Store } from "./store";
export function seed(store: Store) {
  if (store.buildings().length)
    throw new Error(
      "Demo seed requires an empty database. Export or back up your data first.",
    );
  store.transaction(() => {
    const base = {
      safety_score: 8,
      quiet_score: 7,
      commute_score: 7,
      building_quality_score: 8,
      has_in_unit_washer_dryer: "yes",
      parking_type: "garage",
      neighborhood: "Ballard",
      notes: "DEMO DATA — illustrative, not verified property facts.",
    };
    const unit = {
      unit_number: "608",
      sqft: 617,
      base_rent: 2076,
      parking_cost: 185,
      mandatory_monthly_fees: 45,
      lease_length_months: 18,
      available_date: "2026-10-28",
    };
    const amli = store.saveBuilding({
      ...base,
      name: "AMLI Mark24",
      address: "2428 NW Market St., Seattle, WA 98107",
    });
    store.saveUnit({ ...unit, building_id: amli.id });
    const small = store.saveBuilding({
      ...base,
      name: "Pocket Studios (demo)",
      address: "100 Example Street, Seattle WA 98107",
      max_floorplan_sqft: 525,
    });
    store.saveUnit({ ...unit, building_id: small.id, sqft: 500 });
    store.saveBuilding({
      ...base,
      name: "Laundry Lane (demo)",
      address: "200 Example Avenue, Seattle WA 98107",
      has_in_unit_washer_dryer: "no",
    });
    const watch = store.saveBuilding({
      ...base,
      name: "Autumn Court (demo)",
      address: "300 Example Road, Seattle WA 98107",
      quiet_score: 9,
    });
    store.saveUnit({
      ...unit,
      building_id: watch.id,
      available_date: "2026-09-20",
    });
    const rejected = store.saveBuilding({
      ...base,
      name: "Market House (demo)",
      address: "400 Example Place, Seattle WA 98107",
      quiet_score: 9,
      toured: true,
      tour_date: "2026-09-15",
    });
    store.saveUnit({ ...unit, building_id: rejected.id });
    store.saveBuilding(
      {
        ...rejected,
        manual_status_override: "REJECTED",
        rejection_reason:
          "Terrible soundproofing after tour; traffic and neighbor noise.",
      },
      rejected.id,
    );
    store.saveBuilding({
      name: "New lead (demo)",
      address: "500 Example Lane, Seattle WA 98107",
      notes: "Unreviewed demo building.",
    });
  });
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/seed.ts")) {
  const store = new Store(
    process.env.DB_PATH ?? resolve("data/apartments.sqlite"),
  );
  try {
    seed(store);
    console.log(
      "Added 6 demo buildings. Re-enter 2428 NW Market Street Seattle WA 98107 to test deduplication.",
    );
  } finally {
    store.db.close();
  }
}
