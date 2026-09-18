import { useState, type ReactNode } from "react";
import type { EvaluatedBuilding, EvaluatedUnit } from "../shared/engine";
const money = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(value);

export function UnitInventory({
  building,
  onToggle,
  onDelete,
  busy,
  renderEvaluation,
}: {
  building: EvaluatedBuilding;
  onToggle: (unit: EvaluatedUnit) => Promise<void>;
  onDelete: (unit: EvaluatedUnit) => Promise<void>;
  busy: boolean;
  renderEvaluation: (unit: EvaluatedUnit) => ReactNode;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const units = building.units.filter((unit) => showInactive || unit.active);
  const inactive = building.units.filter((unit) => !unit.active).length;
  return (
    <section
      aria-labelledby="unit-inventory-heading"
      className="unit-inventory"
    >
      <div className="section-head">
        <div>
          <h2 id="unit-inventory-heading">
            Unit Inventory{" "}
            <span className="count">{building.units.length}</span>
          </h2>
          <p className="muted">
            Inventory for {building.name}. Building facts are shared by every
            unit.
          </p>
        </div>
        <a className="button primary" href={"#add/" + building.id}>
          + Add Unit
        </a>
      </div>
      <label className="inline">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => setShowInactive(event.target.checked)}
        />
        Show inactive units ({inactive})
      </label>
      {!building.best_unit && (
        <p className="notice">
          No active unit currently qualifies. A viable building stays on WATCH
          unless a manual status override is set.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "Unit #",
                "Floorplan",
                "Sqft",
                "Base rent",
                "Parking",
                "Base + parking",
                "Mandatory monthly cost",
                "Available date",
                "Lease months",
                "Floor",
                "Unit score",
                "Hard filter result",
                "Active / inactive",
                "Actions",
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <InventoryRow
                key={unit.id}
                unit={unit}
                buildingId={building.id}
                best={building.best_unit?.id === unit.id}
                busy={busy}
                onToggle={onToggle}
                onDelete={onDelete}
                renderEvaluation={renderEvaluation}
              />
            ))}
          </tbody>
        </table>
      </div>
      {!units.length && (
        <p className="empty">
          {building.units.length
            ? "No active units. Turn on “Show inactive units” to view older inventory."
            : "No units yet. Add your first unit to this building."}
        </p>
      )}
    </section>
  );
}

function InventoryRow({
  unit: u,
  buildingId,
  best,
  busy,
  onToggle,
  onDelete,
  renderEvaluation,
}: {
  unit: EvaluatedUnit;
  buildingId: string;
  best: boolean;
  busy: boolean;
  onToggle: (u: EvaluatedUnit) => Promise<void>;
  onDelete: (u: EvaluatedUnit) => Promise<void>;
  renderEvaluation: (u: EvaluatedUnit) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const result = u.passes_hard_filters
    ? "PASS"
    : u.hard_fail_reasons.length
      ? "FAIL"
      : "UNRESOLVED";
  return (
    <>
      <tr
        className={
          best ? "inventory-best" : !u.active ? "inventory-inactive" : ""
        }
      >
        <td>
          <strong>{u.unit_number ? "#" + u.unit_number : "Unnamed"}</strong>
          {best && <small className="best-unit-label">BEST CURRENT UNIT</small>}
        </td>
        <td>{u.floorplan_name || "—"}</td>
        <td>{u.sqft ?? "—"}</td>
        <td>{money(u.base_rent)}</td>
        <td>{money(u.parking_cost)}</td>
        <td>{money(u.base_plus_parking)}</td>
        <td>{money(u.total_mandatory_monthly_cost)}</td>
        <td>{u.available_date ?? "—"}</td>
        <td>{u.lease_length_months ?? "—"}</td>
        <td>{u.floor ?? "—"}</td>
        <td>{u.unit_score.toFixed(1)}</td>
        <td>
          <button
            className={
              "filter-result " +
              (result === "PASS" ? "filter-pass" : "filter-fail")
            }
            aria-expanded={expanded}
            aria-controls={"inventory-details-" + u.id}
            onClick={() => setExpanded(!expanded)}
          >
            {result} · Details
          </button>
        </td>
        <td>{u.active ? "Active" : "Inactive"}</td>
        <td>
          <div className="inventory-actions">
            <a
              className="button"
              href={`#add/${buildingId}/${u.id}`}
              aria-label={"Edit unit " + (u.unit_number || "unnamed")}
            >
              Edit
            </a>
            <button disabled={busy} onClick={() => onToggle(u)}>
              Mark {u.active ? "inactive" : "active"}
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => onDelete(u)}
              aria-label={"Delete unit " + (u.unit_number || "unnamed")}
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr id={"inventory-details-" + u.id}>
          <td colSpan={14} className="inventory-details">
            {renderEvaluation(u)}
            <p>
              View: {u.orientation_or_view || "Unknown"} · Concessions:{" "}
              {u.concession_text || "None recorded"}
            </p>
            <p className="prewrap">{u.notes || "No unit notes."}</p>
            <small>
              First seen {u.first_seen_date.slice(0, 10)} · Last seen{" "}
              {u.last_seen_date.slice(0, 10)} · Updated{" "}
              {u.last_updated.slice(0, 10)}
            </small>
          </td>
        </tr>
      )}
    </>
  );
}
