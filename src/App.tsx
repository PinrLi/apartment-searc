import React, { useEffect, useState } from "react";
import {
  buildingSchema,
  unitSchema,
  statuses,
  parkingTypes,
  weightKeys,
  type Settings,
  type History,
} from "../shared/model";
import {
  rankBuildings,
  type EvaluatedBuilding,
  type EvaluatedUnit,
} from "../shared/engine";
import { normalizeUnit } from "../shared/normalize";
import { QuickSearch } from "./QuickSearch";
import { UnitInventory } from "./UnitInventory";
import { JsonPaste } from "./JsonPaste";

async function api(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch("/api" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error ?? "Request failed");
  return result;
}
const money = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(v);
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");
const title = (s: string) =>
  s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status.toLowerCase()}>{title(status)}</span>
  );
}
function go(path: string) {
  window.location.hash = path;
}
type State = {
  buildings: EvaluatedBuilding[];
  settings: Settings;
  history: History[];
};
type FieldDef = {
  key: string;
  label: string;
  type?: string;
  options?: readonly string[];
  hint?: string;
};
const buildingFields: FieldDef[] = [
  { key: "name", label: "Building name" },
  {
    key: "address",
    label: "Street address",
    hint: "Include city, state, and ZIP consistently. Leave unit numbers out.",
  },
  { key: "neighborhood", label: "Neighborhood" },
  {
    key: "aliases",
    label: "Building aliases",
    type: "aliases",
    hint: "One alternate name per line. Addresses remain the duplicate key.",
  },
  ...[
    "safety_score",
    "quiet_score",
    "commute_score",
    "building_quality_score",
    "management_score",
  ].map((key) => ({ key, label: title(key) + " (1–10)", type: "number" })),
  { key: "parking_type", label: "Parking type", options: parkingTypes },
  {
    key: "has_in_unit_washer_dryer",
    label: "In-unit washer/dryer",
    options: ["unknown", "yes", "no"],
  },
  { key: "smoking_policy", label: "Smoking policy" },
  {
    key: "max_floorplan_sqft",
    label: "Largest floorplan (sqft)",
    type: "number",
    hint: "Only enter a confirmed building-wide maximum.",
  },
  { key: "tour_date", label: "Tour date", type: "date" },
  { key: "toured", label: "Already toured", type: "checkbox" },
  { key: "notes", label: "Building notes", type: "textarea" },
];
const unitFields: FieldDef[] = [
  {
    key: "unit_number",
    label: "Unit number",
    hint: "Blank is allowed; duplicate detection will be limited.",
  },
  { key: "floorplan_name", label: "Floorplan name" },
  ...[
    ["sqft", "Square feet"],
    ["base_rent", "Base rent ($/month)"],
    ["parking_cost", "Parking ($/month)"],
    ["mandatory_monthly_fees", "Mandatory fees ($/month)"],
  ].map(([key, label]) => ({ key, label, type: "number" })),
  { key: "available_date", label: "Available date", type: "date" },
  {
    key: "lease_length_months",
    label: "Lease length (months)",
    type: "number",
  },
  { key: "floor", label: "Floor", type: "number" },
  {
    key: "unit_quality_score",
    label: "Layout / unit quality (1–10)",
    type: "number",
  },
  { key: "orientation_or_view", label: "Orientation / view" },
  { key: "concession_text", label: "Concessions (not deducted from rent)" },
  { key: "active", label: "Active inventory", type: "checkbox" },
  { key: "notes", label: "Unit notes", type: "textarea" },
];
function AliasField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (aliases: string[]) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(() => value.join("\n"));
  return (
    <textarea
      disabled={disabled}
      value={text}
      placeholder={"AMLI Mark 24\nMark24\nMark 24"}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split("\n"));
      }}
    />
  );
}
function Fields({
  fields,
  value,
  onChange,
  disabled = false,
}: {
  fields: FieldDef[];
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fields">
      {fields.map((f) => (
        <label key={f.key} className={f.type === "textarea" ? "wide" : ""}>
          <span>{f.label}</span>
          {f.type === "aliases" ? (
            <AliasField
              value={value[f.key] ?? []}
              disabled={disabled}
              onChange={(aliases) => onChange({ ...value, [f.key]: aliases })}
            />
          ) : f.options ? (
            <select
              disabled={disabled}
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            >
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {title(o)}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              disabled={disabled}
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
          ) : (
            <input
              disabled={disabled}
              type={f.type ?? "text"}
              step={f.type === "number" ? "any" : undefined}
              checked={
                f.type === "checkbox" ? Boolean(value[f.key]) : undefined
              }
              value={f.type === "checkbox" ? undefined : (value[f.key] ?? "")}
              onChange={(e) =>
                onChange({
                  ...value,
                  [f.key]:
                    f.type === "checkbox"
                      ? e.target.checked
                      : f.type === "number"
                        ? e.target.value === ""
                          ? null
                          : Number(e.target.value)
                        : f.type === "date"
                          ? e.target.value || null
                          : e.target.value,
                })
              }
            />
          )}{" "}
          {f.hint && <small>{f.hint}</small>}
        </label>
      ))}
    </div>
  );
}
export function App() {
  const [state, setState] = useState<State | null>(null),
    [route, setRoute] = useState(location.hash.slice(1) || "dashboard"),
    [error, setError] = useState("");
  async function refresh() {
    try {
      setState(await api("/state"));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    refresh();
    const change = () => setRoute(location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const [page, id, unitId] = route.split("/");
  return (
    <>
      <header>
        <a className="brand" href="#dashboard">
          <span className="brand-icon">⌂</span>
          <span>
            Apartment Ledger<small>Your search, remembered.</small>
          </span>
        </a>
        <QuickSearch
          buildings={state?.buildings ?? []}
          loading={!state}
          route={route}
        />
        <span className="local">● Local SQLite · manual research</span>
      </header>
      <nav aria-label="Main navigation">
        {[
          "dashboard",
          "buildings",
          "units",
          "add",
          "paste",
          "rejected",
          "settings",
        ].map((p) => (
          <a key={p} className={page === p ? "selected" : ""} href={"#" + p}>
            {p === "add"
              ? "+ Add Apartment"
              : p === "paste"
                ? "Paste JSON"
                : title(p)}
          </a>
        ))}
      </nav>
      <main>
        {error && (
          <div role="alert" className="error">
            {error} <button onClick={refresh}>Retry</button>
          </div>
        )}
        {!state ? (
          <p>Loading your ledger…</p>
        ) : page === "paste" ? (
          <JsonPaste
            key={route}
            buildingId={id}
            building={state.buildings.find((b) => b.id === id)}
            refresh={refresh}
          />
        ) : page === "add" ? (
          id ? (
            <ExistingEditor
              key={route}
              state={state}
              id={id}
              unitId={unitId}
              refresh={refresh}
            />
          ) : (
            <Editor
              key={route}
              state={state}
              id={id}
              unitId={unitId}
              refresh={refresh}
            />
          )
        ) : page === "detail" ? (
          <Detail key={id} state={state} id={id} refresh={refresh} />
        ) : page === "settings" ? (
          <SettingsPage state={state} refresh={refresh} />
        ) : page === "units" ? (
          <UnitsPage state={state} />
        ) : (
          <Listing state={state} page={page} />
        )}
      </main>
      <footer>
        Manually entered facts. Transparent scores. Your data stays in this
        local database.
      </footer>
    </>
  );
}
function Listing({ state, page }: { state: State; page: string }) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [neighborhood, setNeighborhood] = useState(""),
    [cost, setCost] = useState(""),
    [sqft, setSqft] = useState(""),
    [date, setDate] = useState(""),
    [lease, setLease] = useState(""),
    [parking, setParking] = useState(""),
    [sort, setSort] = useState("workflow");
  let buildings =
    page === "rejected"
      ? state.buildings.filter((b) => b.final_status === "REJECTED")
      : page === "buildings"
        ? [...state.buildings]
        : rankBuildings(state.buildings, sort === "score");
  buildings = buildings.filter(
    (b) =>
      [b.name, b.address, b.neighborhood]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!status || b.final_status === status) &&
      (!neighborhood || b.neighborhood === neighborhood) &&
      (!parking || b.parking_type === parking) &&
      (!cost ||
        (b.best_unit?.base_plus_parking != null &&
          b.best_unit.base_plus_parking <= +cost)) &&
      (!sqft || (b.best_unit?.sqft != null && b.best_unit.sqft >= +sqft)) &&
      (!date ||
        (b.best_unit?.available_date != null &&
          b.best_unit.available_date <= date)) &&
      (!lease ||
        (b.best_unit?.lease_length_months != null &&
          b.best_unit.lease_length_months <= +lease)),
  );
  if (sort !== "workflow")
    buildings.sort((a, b) =>
      sort === "score"
        ? (b.opportunity_score ?? b.building_score) -
          (a.opportunity_score ?? a.building_score)
        : sort === "price"
          ? (a.best_unit?.base_plus_parking ?? Infinity) -
            (b.best_unit?.base_plus_parking ?? Infinity)
          : sort === "sqft"
            ? (b.best_unit?.sqft ?? -1) - (a.best_unit?.sqft ?? -1)
            : sort === "available"
              ? (a.best_unit?.available_date ?? "9999").localeCompare(
                  b.best_unit?.available_date ?? "9999",
                )
              : b.last_reviewed_date.localeCompare(a.last_reviewed_date),
    );
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">SEARCH WORKSPACE</p>
          <h1>
            {page === "dashboard"
              ? "A clearer path to your next home"
              : page === "rejected"
                ? "Rejected, not forgotten"
                : "Your building ledger"}
          </h1>
          <p className="muted">
            {page === "dashboard"
              ? "Prioritize the next step. Keep every review."
              : page === "rejected"
                ? "Reasons and prior reviews stay searchable. Restore a building deliberately."
                : "Permanent properties, with temporary inventory underneath."}
          </p>
        </div>
        <div className="actions">
          <a className="button" href="#paste">
            Paste JSON
          </a>
          <a className="button primary" href="#add">
            + Add Apartment
          </a>
        </div>
      </div>
      {page === "dashboard" && (
        <div className="stats">
          {[
            "Total buildings",
            "UNREVIEWED",
            "WATCH",
            "SHORTLIST",
            "TOUR",
            "FINALIST",
            "REJECTED",
          ].map((s) => (
            <button
              className={status === s ? "active" : ""}
              key={s}
              onClick={() =>
                s === "REJECTED"
                  ? go("rejected")
                  : setStatus(s === "Total buildings" ? "" : s)
              }
            >
              <span>{title(s)}</span>
              <strong>
                {s === "Total buildings"
                  ? state.buildings.length
                  : state.buildings.filter((b) => b.final_status === s).length}
              </strong>
            </button>
          ))}
        </div>
      )}
      <section>
        <div className="section-head">
          <h2>
            {page === "dashboard"
              ? "Current candidates"
              : page === "rejected"
                ? "Rejection archive"
                : "All buildings"}{" "}
            <span className="count">{buildings.length}</span>
          </h2>
          <label className="inline">
            Sort{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="workflow">Workflow priority</option>
              <option value="score">All active by score / score ↓</option>
              <option value="price">Price ↑</option>
              <option value="sqft">Sqft ↓</option>
              <option value="available">Availability ↑</option>
              <option value="reviewed">Last reviewed ↓</option>
            </select>
          </label>
        </div>
        <div className="filters">
          <label>
            Search
            <input
              placeholder="Name, address, neighborhood"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Neighborhood
            <select
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
            >
              <option value="">All neighborhoods</option>
              {[...new Set(state.buildings.map((b) => b.neighborhood))]
                .filter(Boolean)
                .sort()
                .map((n) => (
                  <option key={n}>{n}</option>
                ))}
            </select>
          </label>
          <label>
            Max base + parking
            <input
              type="number"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Any"
            />
          </label>
          <label>
            Min sqft
            <input
              type="number"
              value={sqft}
              onChange={(e) => setSqft(e.target.value)}
              placeholder="Any"
            />
          </label>
          <label>
            Available by
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Max lease (months)
            <input
              type="number"
              value={lease}
              onChange={(e) => setLease(e.target.value)}
              placeholder="Any"
            />
          </label>
          <label>
            Parking
            <select
              value={parking}
              onChange={(e) => setParking(e.target.value)}
            >
              <option value="">All types</option>
              {parkingTypes.map((p) => (
                <option key={p} value={p}>
                  {title(p)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              setQuery("");
              setStatus("");
              setNeighborhood("");
              setCost("");
              setSqft("");
              setDate("");
              setLease("");
              setParking("");
              setSort("workflow");
            }}
          >
            Reset filters
          </button>
        </div>
        <p className="table-note">
          {page === "dashboard"
            ? "Finalist → Tour → Shortlist → Watch → Unreviewed. Signed and rejected buildings are outside active rankings. "
            : ""}
          Score = best qualifying active unit, or building score when none
          qualifies. Unit filters apply to that best unit.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {(page === "rejected"
                  ? [
                      "Building",
                      "Address",
                      "Rejection reason",
                      "Date rejected",
                      "Previous score",
                      "Notes",
                      "Restore",
                    ]
                  : [
                      "Rank",
                      "Building",
                      "Neighborhood",
                      "Final status",
                      "Score",
                      "Best unit",
                      "Sqft",
                      "Base rent",
                      "Parking",
                      "Base + parking",
                      "Total mandatory",
                      "Available",
                      "Lease",
                      "Last reviewed",
                    ]
                ).map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buildings.map((b, i) =>
                page === "rejected" ? (
                  <tr key={b.id}>
                    <td>
                      <a href={"#detail/" + b.id}>{b.name}</a>
                    </td>
                    <td>{b.address}</td>
                    <td className="wrap">
                      {b.rejection_reason || b.failures.join("; ")}
                    </td>
                    <td>{day(rejectionEntry(state.history, b.id)?.at)}</td>
                    <td>
                      {(
                        rejectionEntry(state.history, b.id)?.before
                          ?.opportunity_score ??
                        rejectionEntry(state.history, b.id)?.before
                          ?.building_score ??
                        b.building_score
                      ).toFixed(1)}
                    </td>
                    <td className="wrap">{b.notes}</td>
                    <td>
                      <a href={"#detail/" + b.id}>Review & restore →</a>
                    </td>
                  </tr>
                ) : (
                  <tr key={b.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <a className="building-link" href={"#detail/" + b.id}>
                        {b.name}
                      </a>
                      <small>{b.address}</small>
                    </td>
                    <td>{b.neighborhood || "—"}</td>
                    <td>
                      <Badge status={b.final_status} />
                      {b.manual_status_override && (
                        <small>Manual override</small>
                      )}
                    </td>
                    <td className="score">
                      {(b.opportunity_score ?? b.building_score).toFixed(1)}
                      <small>{b.best_unit ? "Opportunity" : "Building"}</small>
                    </td>
                    <td>
                      {b.best_unit
                        ? b.best_unit.unit_number
                          ? "#" + b.best_unit.unit_number
                          : b.best_unit.floorplan_name || "Unnamed"
                        : "No qualifying unit"}
                    </td>
                    <td>{b.best_unit?.sqft ?? "—"}</td>
                    <td>{money(b.best_unit?.base_rent)}</td>
                    <td>{money(b.best_unit?.parking_cost)}</td>
                    <td>{money(b.best_unit?.base_plus_parking)}</td>
                    <td>{money(b.best_unit?.total_mandatory_monthly_cost)}</td>
                    <td>{b.best_unit?.available_date ?? "—"}</td>
                    <td>
                      {b.best_unit?.lease_length_months
                        ? b.best_unit.lease_length_months + " mo"
                        : "—"}
                    </td>
                    <td>{day(b.last_reviewed_date)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {!buildings.length && (
          <div className="empty">
            <h3>No buildings in this view</h3>
            <p>
              Add your first apartment or adjust the filters. Demo data is
              available with <code>npm run seed</code> on an empty database.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
function rejectionEntry(history: History[], id: string) {
  return history.find(
    (h) =>
      h.building_id === id &&
      h.after?.final_status === "REJECTED" &&
      h.before?.final_status !== "REJECTED",
  );
}
function UnitEvaluation({ u }: { u: EvaluatedUnit }) {
  return (
    <>
      <div className="metrics">
        <span>
          Hard filters{" "}
          <strong>
            {u.hard_fail_reasons.length
              ? "FAIL"
              : u.unresolved.length
                ? "UNRESOLVED"
                : "PASS"}
          </strong>
        </span>
        <span>
          Score <strong>{u.unit_score.toFixed(1)}</strong>
        </span>
        <span>
          Base + parking <strong>{money(u.base_plus_parking)}</strong>
        </span>
        <span>
          Total monthly <strong>{money(u.total_mandatory_monthly_cost)}</strong>
        </span>
        <span>
          Budget margin <strong>{money(u.budget_margin)}</strong>
        </span>
      </div>
      {u.hard_fail_reasons.length > 0 && (
        <div className="error">
          <strong>Hard filter failures</strong>
          <ul>
            {u.hard_fail_reasons.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {[...u.unresolved, ...u.warnings].length > 0 && (
        <div className="notice">
          <ul>
            {[...u.unresolved, ...u.warnings].map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary>Score breakdown (component scores out of 100)</summary>
        <div className="metrics">
          {Object.entries(u.components).map(([key, v]) => (
            <span key={key}>
              {title(key)}
              <strong>{v.toFixed(1)}</strong>
            </span>
          ))}
        </div>
      </details>
    </>
  );
}
function UnitsPage({ state }: { state: State }) {
  const [q, setQ] = useState(""),
    [active, setActive] = useState(false);
  return (
    <>
      <h1>Unit inventory</h1>
      <p className="muted">
        Unit failures do not permanently reject an otherwise viable building.
      </p>
      <div className="filters">
        <label>
          Search units
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Building, address, unit"
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active only
        </label>
      </div>
      {state.buildings.flatMap((b) =>
        b.units
          .filter(
            (u) =>
              (!active || u.active) &&
              `${b.name} ${b.address} ${u.unit_number}`
                .toLowerCase()
                .includes(q.toLowerCase()),
          )
          .map((u) => (
            <section key={u.id}>
              <div className="section-head">
                <h2>
                  <a href={"#detail/" + b.id}>{b.name}</a> ·{" "}
                  {u.unit_number ? "#" + u.unit_number : "Unnamed unit"}{" "}
                  {!u.active && <span className="muted">(inactive)</span>}
                </h2>
                <a className="button" href={`#add/${b.id}/${u.id}`}>
                  Edit unit
                </a>
              </div>
              <p>
                {u.sqft ?? "?"} sqft · Available {u.available_date ?? "unknown"}{" "}
                · {u.lease_length_months ?? "?"} months
              </p>
              <UnitEvaluation u={u} />
            </section>
          )),
      )}
      {!state.buildings.some((b) => b.units.length) && (
        <div className="empty">No units yet. Add an apartment to start.</div>
      )}
    </>
  );
}
export function Detail({
  state,
  id,
  refresh,
}: {
  state: State;
  id: string;
  refresh: () => Promise<void>;
}) {
  const b = state.buildings.find((b) => b.id === id);
  const [error, setError] = useState(""),
    [reason, setReason] = useState(b?.rejection_reason ?? ""),
    [busy, setBusy] = useState(false);
  if (!b)
    return (
      <p>
        Building not found. <a href="#buildings">Back to buildings</a>
      </p>
    );
  async function override(status: string | null) {
    setBusy(true);
    try {
      await api(
        "/buildings/" + id,
        {
          ...b,
          manual_status_override: status,
          rejection_reason: reason || null,
          finalist: status === "FINALIST",
          signed: status === "SIGNED",
        },
        "PUT",
      );
      await refresh();
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(unit?: EvaluatedUnit) {
    if (
      !confirm(
        unit
          ? "Delete this unit? Its change history is retained."
          : "Delete this building and its units? Export a backup first if you may need them.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(
        unit ? "/units/" + unit.id : "/buildings/" + id,
        undefined,
        "DELETE",
      );
      await refresh();
      if (!unit) go("buildings");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggleUnit(unit: EvaluatedUnit) {
    setBusy(true);
    try {
      await api("/units/" + unit.id, { ...unit, active: !unit.active }, "PUT");
      await refresh();
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const history = state.history.filter((h) => h.building_id === id);
  return (
    <>
      <a href="#buildings">← Buildings</a>
      <div className="page-title">
        <div>
          <h1>{b.name}</h1>
          <p className="muted">
            {b.address} · {b.neighborhood}
          </p>
        </div>
        <div className="actions">
          <a className="button" href={"#add/" + id + "/building"}>
            Edit Building
          </a>
          <a className="button" href={"#paste/" + id}>
            Add / Update via JSON
          </a>
          <a className="button primary" href={"#add/" + id}>
            + Add Unit
          </a>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section>
        <div className="metrics">
          <span>
            Building score<strong>{b.building_score.toFixed(1)}</strong>
          </span>
          <span>
            Opportunity score
            <strong>{b.opportunity_score?.toFixed(1) ?? "—"}</strong>
          </span>
          <span>
            Auto status
            <Badge status={b.auto_status} />
          </span>
          <span>
            Manual override
            <strong>
              {b.manual_status_override
                ? title(b.manual_status_override)
                : "None"}
            </strong>
          </span>
          <span>
            Final status
            <Badge status={b.final_status} />
          </span>
        </div>
        {b.best_unit && (
          <p>
            Rank driven by unit{" "}
            <strong>
              #
              {b.best_unit.unit_number ||
                b.best_unit.floorplan_name ||
                "unnamed"}
            </strong>
            .
          </p>
        )}
        {b.failures.length > 0 && (
          <div className="error">
            <strong>Building-level failures</strong>
            <ul>
              {b.failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {b.unresolved.length > 0 && (
          <div className="notice">{b.unresolved.join(" · ")}</div>
        )}
        {b.auto_status === "WATCH" && (
          <p className="notice">
            Building is viable. No active unit currently passes all hard
            filters. Price, size, and date failures on a unit do not reject this
            building.
          </p>
        )}
        <h3>Search decisions</h3>
        <label>
          Rejection reason / retained reason
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required when rejecting"
          />
        </label>
        <div className="actions">
          {["REJECTED", "WATCH", "SHORTLIST", "TOUR", "FINALIST", "SIGNED"].map(
            (s) => (
              <button
                disabled={busy}
                className={s === "REJECTED" ? "danger" : ""}
                key={s}
                onClick={() => override(s)}
              >
                {s === "REJECTED"
                  ? "Reject"
                  : s === "WATCH"
                    ? "Move to Watch"
                    : "Mark " + title(s)}
              </button>
            ),
          )}
          <button disabled={busy} onClick={() => override(null)}>
            Clear Manual Override
          </button>
        </div>
        <p className="muted">
          Overrides persist until you change or clear them. Clearing an override
          reapplies the current rules. TOUR means a planned tour; record
          completed tours below.
        </p>
      </section>
      <UnitInventory
        building={b}
        onToggle={toggleUnit}
        onDelete={remove}
        busy={busy}
        renderEvaluation={(u) => <UnitEvaluation u={u} />}
      />
      <section>
        <h2>Building facts & notes</h2>
        <dl className="facts">
          {buildingFields
            .filter((f) => !["name", "address", "notes"].includes(f.key))
            .map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{String((b as any)[f.key] ?? "Unknown")}</dd>
              </div>
            ))}
        </dl>
        <p className="prewrap">{b.notes || "No notes yet."}</p>
        <div className="metrics">
          <span>
            First seen<strong>{day(b.first_seen_date)}</strong>
          </span>
          <span>
            Last reviewed<strong>{day(b.last_reviewed_date)}</strong>
          </span>
          <span>
            Last updated<strong>{day(b.last_updated)}</strong>
          </span>
        </div>
      </section>
      <section>
        <h2>Review & rejection history</h2>
        <p className="muted">
          Includes snapshots of status and score at the time of each change.
        </p>
        {history.map((h) => (
          <HistoryRow key={h.id} h={h} />
        ))}
        {!history.length && <p>No changes recorded.</p>}
      </section>
      <button className="danger" onClick={() => remove()}>
        Delete building and units
      </button>
    </>
  );
}
function HistoryRow({ h }: { h: History }) {
  const keys = [
    "base_rent",
    "parking_cost",
    "available_date",
    "active",
    "manual_status_override",
    "final_status",
    "rejection_reason",
    "building_score",
    "opportunity_score",
    "quiet_score",
    "notes",
  ];
  const changes = keys.filter(
    (k) =>
      h.before?.[k] !== h.after?.[k] &&
      (h.before?.[k] != null || h.after?.[k] != null),
  );
  const delta =
    h.before?.base_rent != null && h.after?.base_rent != null
      ? h.after.base_rent - h.before.base_rent
      : null;
  return (
    <details className="history">
      <summary>
        <time>{new Date(h.at).toLocaleString()}</time>{" "}
        <strong>{h.action}</strong>
        {h.unit_id && (
          <span>
            {" "}
            · Unit #{h.after?.unit_number || h.before?.unit_number || "unnamed"}
          </span>
        )}
        {delta !== null && delta !== 0 && (
          <span className={delta < 0 ? "saving" : ""}>
            {" "}
            · Rent {delta < 0 ? "↓" : "↑"} {money(Math.abs(delta))}
          </span>
        )}
        {h.after?.final_status === "REJECTED" && (
          <span>
            {" "}
            · REJECTED:{" "}
            {h.after.rejection_reason || h.after.failures?.join("; ")}
          </span>
        )}
      </summary>
      {changes.map((k) => (
        <p key={k}>
          {title(k)}: <s>{String(h.before?.[k] ?? "—")}</s> →{" "}
          {String(h.after?.[k] ?? "—")}
        </p>
      ))}
      <details>
        <summary>Full saved snapshot</summary>
        <pre>
          {JSON.stringify({ before: h.before, after: h.after }, null, 2)}
        </pre>
      </details>
    </details>
  );
}
export function ExistingEditor({
  state,
  id,
  unitId,
  refresh,
}: {
  state: State;
  id: string;
  unitId?: string;
  refresh: () => Promise<void>;
}) {
  const building = state.buildings.find((b) => b.id === id);
  const buildingOnly = unitId === "building";
  const oldUnit = building?.units.find((u) => u.id === unitId);
  const [value, setValue] = useState<any>(
    buildingOnly
      ? building
      : (oldUnit ?? unitSchema.parse({ building_id: id })),
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<any>(null);
  if (!building || (unitId && !buildingOnly && !oldUnit))
    return (
      <p>
        Building or unit not found. <a href="#buildings">Back to buildings</a>
      </p>
    );
  const duplicate =
    !buildingOnly && normalizeUnit(value.unit_number)
      ? building.units.find(
          (u) =>
            u.id !== oldUnit?.id &&
            normalizeUnit(u.unit_number) === normalizeUnit(value.unit_number),
        )
      : null;
  function change(next: any) {
    setValue(next);
    setPreview(null);
  }
  async function evaluate() {
    setBusy(true);
    setError("");
    try {
      setPreview(
        await api("/preview", {
          building,
          building_id: id,
          unit: value,
          unit_id: oldUnit?.id,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (buildingOnly)
        await api("/buildings/" + id, buildingSchema.parse(value), "PUT");
      else if (oldUnit)
        await api(
          "/units/" + oldUnit.id,
          unitSchema.parse({ ...value, building_id: id }),
          "PUT",
        );
      else
        await api("/apartment", {
          building_id: id,
          unit: unitSchema.parse({ ...value, building_id: id }),
        });
      await refresh();
      go("detail/" + id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a href={"#detail/" + id}>← {building.name}</a>
      <div className="page-title">
        <div>
          <h1>
            {buildingOnly
              ? "Edit Building"
              : oldUnit
                ? "Edit Unit"
                : "Add Unit"}{" "}
            — {building.name}
          </h1>
          <p className="muted">
            {buildingOnly
              ? "Permanent building facts shared by all units."
              : building.address}
          </p>
        </div>
        <a className="button" href={"#detail/" + id}>
          Cancel
        </a>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={save}>
        <section>
          <h2>
            {buildingOnly
              ? "Building facts"
              : oldUnit
                ? "Unit #" + (oldUnit.unit_number || "Unnamed")
                : "New unit"}
          </h2>
          {!buildingOnly && (
            <p className="muted">
              Enter 0 for known zero costs; leave unknown values blank.
              Deactivate old inventory to preserve its history.
            </p>
          )}
          <Fields
            fields={buildingOnly ? buildingFields : unitFields}
            value={value}
            onChange={change}
            disabled={busy}
          />
          {!buildingOnly && !normalizeUnit(value.unit_number) && (
            <p className="notice">
              No unit number: reliable unit deduplication is not possible.{" "}
              {oldUnit
                ? "Saving updates this same unit and keeps its history."
                : "Check existing inventory before adding a separate record."}
            </p>
          )}
          {duplicate && (
            <p className="error">
              Existing unit found: #{duplicate.unit_number}.{" "}
              <a href={`#add/${id}/${duplicate.id}`}>Edit the existing unit</a>{" "}
              to retain its history.
            </p>
          )}
          <div className="actions">
            {!buildingOnly && (
              <button
                type="button"
                disabled={busy || Boolean(duplicate)}
                onClick={evaluate}
              >
                Preview evaluation
              </button>
            )}
            <button
              type="submit"
              className="primary"
              disabled={busy || Boolean(duplicate)}
            >
              {busy
                ? "Saving…"
                : buildingOnly
                  ? "Save Building"
                  : oldUnit
                    ? "Save Unit"
                    : "Add Unit"}
            </button>
          </div>
        </section>
      </form>
      {preview && !buildingOnly && (
        <section>
          <h2>Unit evaluation</h2>
          <UnitEvaluation
            u={preview.evaluation.units.find(
              (u: EvaluatedUnit) => u.id === (oldUnit?.id ?? "preview-unit"),
            )}
          />
          <p>
            Building auto status:{" "}
            <Badge status={preview.evaluation.auto_status} /> · Final status:{" "}
            <Badge status={preview.evaluation.final_status} /> · Opportunity
            score: {preview.evaluation.opportunity_score?.toFixed(1) ?? "—"} ·
            Rank: {preview.rank ?? "Outside active ranking"}
          </p>
        </section>
      )}
    </>
  );
}
function Editor({
  state,
  id,
  unitId,
  refresh,
}: {
  state: State;
  id?: string;
  unitId?: string;
  refresh: () => Promise<void>;
}) {
  const existing = state.buildings.find((b) => b.id === id),
    oldUnit = existing?.units.find((u) => u.id === unitId);
  const [building, setBuilding] = useState<any>(
    existing ?? {
      ...buildingSchema.parse({ name: "New building", address: "Unknown" }),
      name: "",
      address: "",
    },
  );
  const [unit, setUnit] = useState<any>(oldUnit ?? unitSchema.parse({})),
    [buildingId, setBuildingId] = useState(id),
    [step, setStep] = useState(id ? 2 : 1),
    [updateBuilding, setUpdateBuilding] = useState(unitId === "building"),
    [includeUnit, setIncludeUnit] = useState(unitId !== "building"),
    [duplicate, setDuplicate] = useState<EvaluatedBuilding | null>(null),
    [duplicateChecked, setDuplicateChecked] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (step !== 1) return;
    setDuplicateChecked(false);
    setDuplicate(null);
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const match = await api(
          "/duplicate?address=" + encodeURIComponent(building.address),
        );
        if (current) {
          setDuplicate(match);
          setDuplicateChecked(true);
          setError("");
        }
      } catch (e) {
        if (current) setError(String(e));
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [building.address, step]);
  const matchUnit =
    buildingId && unit.unit_number
      ? state.buildings
          .find((b) => b.id === buildingId)
          ?.units.find(
            (u) =>
              normalizeUnit(u.unit_number) ===
                normalizeUnit(unit.unit_number) && u.id !== oldUnit?.id,
          )
      : null;
  function useExisting(update: boolean) {
    if (!duplicate) return;
    go("add/" + duplicate.id + (update ? "/building" : ""));
  }
  async function evaluate() {
    setBusy(true);
    try {
      const effectiveBuilding =
        buildingId && !updateBuilding
          ? state.buildings.find((b) => b.id === buildingId)
          : building;
      const p = await api("/preview", {
        building: effectiveBuilding,
        building_id: buildingId,
        unit: includeUnit ? unit : null,
        unit_id: oldUnit?.id,
      });
      setPreview(p);
      setStep(4);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await api("/apartment", {
        building,
        building_id: buildingId,
        update_building: updateBuilding,
        unit: includeUnit ? unit : null,
        unit_id: oldUnit?.id,
      });
      await refresh();
      go("detail/" + r.building_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>
            {oldUnit
              ? "Update unit"
              : unitId === "building"
                ? "Update building"
                : "Add apartment"}
          </h1>
          <p className="muted">
            Check the address first. Keep existing reviews connected.
          </p>
        </div>
        <button
          onClick={() => go(buildingId ? "detail/" + buildingId : "buildings")}
        >
          Cancel
        </button>
      </div>
      <ol className="steps">
        {[
          "Identify building",
          "Building facts",
          "Unit inventory",
          "Evaluate & save",
        ].map((s, i) => (
          <li className={step === i + 1 ? "current" : ""} key={s}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section>
        {step === 1 ? (
          <>
            <h2>Have you reviewed this address?</h2>
            <Fields
              fields={buildingFields.slice(0, 2)}
              value={building}
              onChange={setBuilding}
            />
            {duplicate ? (
              <div className="duplicate">
                <h2>Existing building found</h2>
                <h3>
                  {duplicate.name} · Previously reviewed:{" "}
                  {duplicate.final_status}
                </h3>
                <p>{duplicate.address}</p>
                <p>
                  Score{" "}
                  {(
                    duplicate.opportunity_score ?? duplicate.building_score
                  ).toFixed(1)}{" "}
                  · First seen {day(duplicate.first_seen_date)} · Last reviewed{" "}
                  {day(duplicate.last_reviewed_date)}
                </p>
                <p className="prewrap">{duplicate.notes || "No notes yet."}</p>
                {(duplicate.rejection_reason ||
                  duplicate.failures.length > 0) && (
                  <p>
                    <strong>Reason:</strong>{" "}
                    {duplicate.rejection_reason ||
                      duplicate.failures.join("; ")}
                  </p>
                )}
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => useExisting(false)}
                  >
                    Add unit to existing building
                  </button>
                  <button onClick={() => useExisting(true)}>
                    Update existing building
                  </button>
                  <a href={"#detail/" + duplicate.id}>Open previous review</a>
                </div>
              </div>
            ) : (
              <>
                <p className="muted">
                  {duplicateChecked
                    ? "No exact normalized-address match."
                    : "Checking address…"}{" "}
                  Check name and address manually if the city or ZIP formatting
                  differs.
                </p>
                <button
                  className="primary"
                  disabled={
                    !duplicateChecked ||
                    !building.name.trim() ||
                    building.address.trim().length < 3
                  }
                  onClick={() => {
                    setStep(2);
                    setUpdateBuilding(true);
                  }}
                >
                  Continue
                </button>
              </>
            )}
          </>
        ) : step === 2 ? (
          <>
            <h2>Building facts</h2>
            {buildingId && (
              <label className="inline">
                <input
                  type="checkbox"
                  checked={updateBuilding}
                  onChange={(e) => setUpdateBuilding(e.target.checked)}
                />
                Update existing building facts
              </label>
            )}
            <p className="muted">
              Blank numeric values mean unknown. Existing workflow decisions are
              preserved.
            </p>
            <Fields
              fields={buildingFields}
              value={building}
              onChange={setBuilding}
              disabled={Boolean(buildingId && !updateBuilding)}
            />
            <div className="actions">
              <button
                onClick={() => {
                  if (!id) {
                    setBuildingId(undefined);
                    setStep(1);
                  } else go("detail/" + id);
                }}
              >
                Back
              </button>
              <button className="primary" onClick={() => setStep(3)}>
                Continue to unit
              </button>
            </div>
          </>
        ) : step === 3 ? (
          <>
            <h2>{oldUnit ? "Update inventory" : "Unit inventory"}</h2>
            <label className="inline">
              <input
                type="checkbox"
                checked={includeUnit}
                disabled={Boolean(oldUnit)}
                onChange={(e) => setIncludeUnit(e.target.checked)}
              />
              Include a unit in this review
            </label>
            {includeUnit && (
              <>
                <p className="muted">
                  Enter 0 for known zero costs; leave unknown costs blank.
                  Availability is checked against the inclusive move-in window.
                </p>
                <Fields fields={unitFields} value={unit} onChange={setUnit} />
                {!unit.unit_number && (
                  <p className="notice">
                    No unit number: a separate record will be created. Check
                    existing inventory first.
                  </p>
                )}
                {matchUnit && (
                  <p className="error">
                    Existing unit found: #{matchUnit.unit_number}.{" "}
                    <a href={`#add/${buildingId}/${matchUnit.id}`}>
                      Edit the existing unit
                    </a>{" "}
                    to retain its price history.
                  </p>
                )}
              </>
            )}
            <div className="actions">
              <button onClick={() => setStep(2)}>Back</button>
              <button
                disabled={busy || Boolean(includeUnit && matchUnit)}
                className="primary"
                onClick={evaluate}
              >
                Preview evaluation
              </button>
            </div>
          </>
        ) : (
          preview && (
            <>
              <h2>Review before saving</h2>
              <div className="metrics">
                <span>
                  Building score
                  <strong>
                    {preview.evaluation.building_score.toFixed(1)}
                  </strong>
                </span>
                <span>
                  Auto status
                  <Badge status={preview.evaluation.auto_status} />
                </span>
                <span>
                  Final status
                  <Badge status={preview.evaluation.final_status} />
                </span>
                <span>
                  Current rank estimate
                  <strong>{preview.rank ?? "Outside active ranking"}</strong>
                </span>
              </div>
              <p>
                Duplicate status:{" "}
                {buildingId
                  ? "Existing building — linked review"
                  : "New building"}
                {oldUnit
                  ? " · Updating existing unit"
                  : includeUnit
                    ? " · New unit"
                    : ""}
                .
              </p>
              {preview.evaluation.failures.length > 0 && (
                <p className="error">
                  Building failures: {preview.evaluation.failures.join("; ")}
                </p>
              )}
              {preview.evaluation.unresolved.length > 0 && (
                <p className="notice">
                  {preview.evaluation.unresolved.join("; ")}
                </p>
              )}
              {includeUnit && (
                <UnitEvaluation
                  u={preview.evaluation.units.find(
                    (u: any) => u.id === (oldUnit?.id ?? "preview-unit"),
                  )}
                />
              )}
              <p className="muted">
                Final status respects the saved manual override. Rank is
                estimated using the current settings and candidates.
              </p>
              <div className="actions">
                <button disabled={busy} onClick={() => setStep(3)}>
                  Back
                </button>
                <button className="primary" disabled={busy} onClick={save}>
                  {busy ? "Saving…" : "Save review"}
                </button>
              </div>
            </>
          )
        )}
      </section>
    </>
  );
}
function SettingsPage({
  state,
  refresh,
}: {
  state: State;
  refresh: () => Promise<void>;
}) {
  const [s, setS] = useState<Settings>(structuredClone(state.settings)),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [data, setData] = useState<any>(null),
    [report, setReport] = useState<any>(null),
    [includeSettings, setIncludeSettings] = useState(false),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/settings", s, "PUT");
      await refresh();
      setMessage(
        "Settings saved. All current scores and statuses recalculated; manual overrides preserved.",
      );
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function readFile(file?: File) {
    setReport(null);
    setData(null);
    setMessage("");
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const plan = await api("/import/preview", { data: value });
      setData(value);
      setReport(plan);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function importData() {
    setBusy(true);
    try {
      const result = await api("/import", {
        data,
        include_settings: includeSettings,
      });
      await refresh();
      if (includeSettings && data.settings) setS(data.settings);
      setMessage(
        `Imported ${result.new_buildings} buildings and ${result.new_units} units. Existing records retained.`,
      );
      setData(null);
      setReport(null);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>Rules & data</h1>
      <p className="muted">
        Tune your search without editing code. Scores rank quality; statuses
        track decisions.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      <form onSubmit={save}>
        <section>
          <h2>Hard requirements</h2>
          <Fields
            fields={[
              { key: "min_sqft", label: "Minimum sqft", type: "number" },
              {
                key: "budget",
                label: "Base + parking must be under ($)",
                type: "number",
              },
              { key: "earliest", label: "Earliest move-in", type: "date" },
              { key: "latest", label: "Latest move-in", type: "date" },
              {
                key: "min_safety",
                label: "Minimum safety (1–10)",
                type: "number",
              },
              {
                key: "min_quiet",
                label: "Minimum quiet (1–10)",
                type: "number",
              },
            ]}
            value={s}
            onChange={setS}
          />
          <p className="muted">
            Acceptable parking: garage, covered, or community lot. In-unit
            washer/dryer required. Dates include both endpoints. Mandatory fees
            are displayed separately from the budget filter.
          </p>
        </section>
        <section>
          <h2>
            Scoring weights{" "}
            <span className="count">
              {Object.values(s.weights).reduce((a, b) => a + b, 0)} / 100%
            </span>
          </h2>
          <Fields
            fields={weightKeys.map((k) => ({
              key: k,
              label: title(k) + " (%)",
              type: "number",
            }))}
            value={s.weights}
            onChange={(weights) => setS({ ...s, weights })}
          />
        </section>
        <section>
          <h2>Price curve</h2>
          <p className="muted">
            Piecewise linear, from lowest price to highest. Component scores are
            out of 100; the default 20% price weight converts them to 20 points.
          </p>
          {s.price_points.map(([cost, score], i) => (
            <div className="curve" key={i}>
              <label>
                Base + parking ($)
                <input
                  type="number"
                  required
                  value={cost}
                  onChange={(e) =>
                    setS({
                      ...s,
                      price_points: s.price_points.map((p, j) =>
                        j === i ? [+e.target.value, p[1]] : p,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Score (0–100)
                <input
                  type="number"
                  required
                  value={score}
                  onChange={(e) =>
                    setS({
                      ...s,
                      price_points: s.price_points.map((p, j) =>
                        j === i ? [p[0], +e.target.value] : p,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                disabled={s.price_points.length <= 2}
                onClick={() =>
                  setS({
                    ...s,
                    price_points: s.price_points.filter((_, j) => j !== i),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setS({
                ...s,
                price_points: [
                  ...s.price_points,
                  [s.price_points.at(-1)![0] + 100, 0],
                ],
              })
            }
          >
            + Price threshold
          </button>
        </section>
        <section>
          <h2>Parking & lease scores</h2>
          <h3>Parking (0–100)</h3>
          <Fields
            fields={parkingTypes.map((k) => ({
              key: k,
              label: title(k),
              type: "number",
            }))}
            value={s.parking_scores}
            onChange={(parking_scores) => setS({ ...s, parking_scores })}
          />
          <h3>Lease commitment (0–100)</h3>
          <Fields
            fields={Object.keys(s.lease_scores).map((k) => ({
              key: k,
              label: title(k) + " months",
              type: "number",
            }))}
            value={s.lease_scores}
            onChange={(lease_scores) => setS({ ...s, lease_scores })}
          />
        </section>
        <section>
          <h2>Size / layout</h2>
          <Fields
            fields={[
              {
                key: "size_cap",
                label: "Size bonus cap (sqft)",
                type: "number",
              },
              {
                key: "size_min_score",
                label: "Size score at minimum (0–100)",
                type: "number",
              },
              {
                key: "layout_share",
                label: "Manual layout share (0–1)",
                type: "number",
              },
            ]}
            value={s}
            onChange={setS}
          />
          <p className="muted">
            Size rises linearly from the minimum to the cap. When layout quality
            is unknown, size alone drives this component.
          </p>
        </section>
        <button type="submit" className="primary" disabled={busy}>
          Save settings & recalculate
        </button>
      </form>
      <section className="portability">
        <h2>Your data, portable</h2>
        <p>
          JSON is a full backup of records, settings, and history. CSV is a
          flattened building/unit report for spreadsheets.
        </p>
        <div className="actions">
          <a className="button" href="/api/export/json" download>
            Export JSON
          </a>
          <a className="button" href="/api/export/csv" download>
            Export CSV
          </a>
        </div>
        <h3>Import JSON</h3>
        <p className="muted">
          Preview first. Matching addresses and unit numbers are linked;
          existing records are kept. Import adds new records without overwriting
          prior decisions. No-number units from the same export are recognized
          by ID.
        </p>
        <label>
          Choose an exported JSON file
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </label>
        {report && (
          <div className="notice">
            <h3>Import preview</h3>
            <div className="metrics">
              {Object.entries(report).map(([k, v]) => (
                <span key={k}>
                  {title(k)}
                  <strong>{String(v)}</strong>
                </span>
              ))}
            </div>
            <label className="inline">
              <input
                type="checkbox"
                checked={includeSettings}
                disabled={!data.settings}
                onChange={(e) => setIncludeSettings(e.target.checked)}
              />
              Also replace settings with the imported settings
            </label>
            <button className="primary" disabled={busy} onClick={importData}>
              Import new records
            </button>
          </div>
        )}
      </section>
    </>
  );
}
