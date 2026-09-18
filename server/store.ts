import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildingSchema,
  unitSchema,
  settingsSchema,
  defaults,
  type Building,
  type Unit,
  type History,
  type Settings,
} from "../shared/model";
import { normalizeAddress, normalizeUnit } from "../shared/normalize";
import { evaluateBuilding } from "../shared/engine";

export class Conflict extends Error {
  constructor(
    message: string,
    public existing: any,
  ) {
    super(message);
  }
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS buildings(id TEXT PRIMARY KEY, normalized_address TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY, building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE, normalized_unit_number TEXT NOT NULL, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS unit_dedup ON units(building_id,normalized_unit_number) WHERE normalized_unit_number <> '';
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, building_id TEXT NOT NULL, unit_id TEXT, at TEXT NOT NULL, action TEXT NOT NULL, before_data TEXT, after_data TEXT);
      PRAGMA user_version=1;`);
    this.db
      .prepare("INSERT OR IGNORE INTO settings VALUES(1,?)")
      .run(JSON.stringify(defaults));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  buildings(): Building[] {
    return this.db
      .prepare("SELECT data FROM buildings")
      .all()
      .map((r) => ({ aliases: [], ...JSON.parse(String(r.data)) }));
  }
  units(): Unit[] {
    return this.db
      .prepare("SELECT data FROM units")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  settings(): Settings {
    return JSON.parse(
      String(
        this.db.prepare("SELECT data FROM settings WHERE id=1").get()!.data,
      ),
    );
  }
  history(): History[] {
    return this.db
      .prepare("SELECT * FROM history ORDER BY at DESC, rowid DESC")
      .all()
      .map((r) => ({
        id: String(r.id),
        building_id: String(r.building_id),
        unit_id: r.unit_id === null ? null : String(r.unit_id),
        at: String(r.at),
        action: String(r.action),
        before: r.before_data ? JSON.parse(String(r.before_data)) : null,
        after: r.after_data ? JSON.parse(String(r.after_data)) : null,
      }));
  }
  snapshot() {
    const units = this.units(),
      settings = this.settings();
    return {
      buildings: this.buildings().map((b) =>
        evaluateBuilding(b, units, settings),
      ),
      settings,
      history: this.history(),
    };
  }
  record(
    building_id: string,
    unit_id: string | null,
    action: string,
    before: any,
    after: any,
  ) {
    this.db
      .prepare("INSERT INTO history VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        building_id,
        unit_id,
        new Date().toISOString(),
        action,
        JSON.stringify(before),
        JSON.stringify(after),
      );
  }
  saveBuilding(raw: unknown, id?: string, preserved?: Partial<Building>) {
    const input = buildingSchema.parse(raw),
      normalized_address = normalizeAddress(input.address);
    if (!normalized_address)
      throw new Error("Address must contain letters or numbers");
    const old = id ? this.buildings().find((b) => b.id === id) : undefined;
    if (id && !old) throw new Error("Building not found");
    const duplicate = this.buildings().find(
      (b) => b.normalized_address === normalized_address && b.id !== id,
    );
    if (duplicate)
      throw new Conflict(
        "Existing building found",
        evaluateBuilding(duplicate, this.units(), this.settings()),
      );
    const now = new Date().toISOString();
    const b: Building = {
      ...input,
      id: id ?? randomUUID(),
      normalized_address,
      first_seen_date:
        old?.first_seen_date ?? preserved?.first_seen_date ?? now,
      last_reviewed_date: preserved?.last_reviewed_date ?? now,
      last_updated: preserved?.last_updated ?? now,
    };
    this.db
      .prepare(
        "INSERT INTO buildings VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET normalized_address=excluded.normalized_address,data=excluded.data",
      )
      .run(b.id, normalized_address, JSON.stringify(b));
    this.record(
      b.id,
      null,
      old ? "Building updated" : "Building added",
      old ? evaluateBuilding(old, this.units(), this.settings()) : null,
      evaluateBuilding(b, this.units(), this.settings()),
    );
    return b;
  }
  saveUnit(raw: unknown, id?: string, preserved?: Partial<Unit>) {
    const input = unitSchema.parse(raw);
    const b = this.buildings().find((b) => b.id === input.building_id);
    if (!b) throw new Error("Building not found");
    const old = id ? this.units().find((u) => u.id === id) : undefined;
    if (id && !old) throw new Error("Unit not found");
    if (old && old.building_id !== input.building_id)
      throw new Error("Cannot move a unit to another building");
    const normalized_unit_number = normalizeUnit(input.unit_number);
    const duplicate = normalized_unit_number
      ? this.units().find(
          (u) =>
            u.building_id === input.building_id &&
            u.normalized_unit_number === normalized_unit_number &&
            u.id !== id,
        )
      : null;
    if (duplicate)
      throw new Conflict("Existing unit found; edit it instead", duplicate);
    const before = evaluateBuilding(b, this.units(), this.settings());
    const now = new Date().toISOString();
    const u: Unit = {
      ...input,
      id: id ?? randomUUID(),
      normalized_unit_number,
      first_seen_date:
        old?.first_seen_date ?? preserved?.first_seen_date ?? now,
      last_seen_date: preserved?.last_seen_date ?? now,
      last_updated: preserved?.last_updated ?? now,
    };
    this.db
      .prepare(
        "INSERT INTO units VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,normalized_unit_number=excluded.normalized_unit_number",
      )
      .run(u.id, b.id, normalized_unit_number, JSON.stringify(u));
    this.db
      .prepare("UPDATE buildings SET data=? WHERE id=?")
      .run(
        JSON.stringify({ ...b, last_updated: now, last_reviewed_date: now }),
        b.id,
      );
    this.record(
      b.id,
      u.id,
      old ? "Unit updated" : "Unit added",
      old ?? null,
      u,
    );
    const after = evaluateBuilding(b, this.units(), this.settings());
    this.record(b.id, null, "Evaluation updated", before, after);
    return u;
  }
  deleteUnit(id: string) {
    const u = this.units().find((u) => u.id === id);
    if (!u) throw new Error("Unit not found");
    this.record(u.building_id, id, "Unit deleted", u, null);
    this.db.prepare("DELETE FROM units WHERE id=?").run(id);
  }
  deleteBuilding(id: string) {
    const b = this.buildings().find((b) => b.id === id);
    if (!b) throw new Error("Building not found");
    this.record(
      id,
      null,
      "Building deleted",
      { building: b, units: this.units().filter((u) => u.building_id === id) },
      null,
    );
    this.db.prepare("DELETE FROM buildings WHERE id=?").run(id);
  }
  saveSettings(raw: unknown) {
    const settings = settingsSchema.parse(raw);
    const before = this.snapshot();
    this.db
      .prepare("UPDATE settings SET data=? WHERE id=1")
      .run(JSON.stringify(settings));
    this.record("", null, "Settings updated", before.settings, settings);
    for (const b of before.buildings)
      this.record(
        b.id,
        null,
        "Settings recalculation",
        b,
        evaluateBuilding(b, this.units(), settings),
      );
    return settings;
  }
  export() {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      buildings: this.buildings(),
      units: this.units(),
      settings: this.settings(),
      history: this.history(),
    };
  }
}
