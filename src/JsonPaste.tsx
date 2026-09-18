import { useState } from "react";
import type { EvaluatedBuilding } from "../shared/engine";
import type { PastePlan } from "../server/paste";

export const jsonTemplate = {
  building: {
    name: "Example Building",
    address: "123 Example Street, Seattle, WA 98107",
    neighborhood: "",
    aliases: [],
    safety_score: null,
    quiet_score: null,
    commute_score: null,
    building_quality_score: null,
    management_score: null,
    parking_type: "unknown",
    has_in_unit_washer_dryer: "unknown",
    smoking_policy: "unknown",
    max_floorplan_sqft: null,
    notes: "",
  },
  units: [
    {
      unit_number: "",
      floorplan_name: "",
      sqft: null,
      base_rent: null,
      parking_cost: null,
      mandatory_monthly_fees: null,
      available_date: null,
      lease_length_months: null,
      floor: null,
      orientation_or_view: "",
      concession_text: "",
      unit_quality_score: null,
      notes: "",
      active: true,
    },
  ],
};
const money = (value: number | null) =>
  value === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);
const display = (field: string, value: unknown) =>
  value === null
    ? "Unknown"
    : ["base_rent", "parking_cost", "mandatory_monthly_fees"].includes(field)
      ? money(value as number)
      : Array.isArray(value)
        ? value.join(", ")
        : String(value);
async function request(path: string, body: unknown) {
  const response = await fetch("/api/paste/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result;
}
export function JsonPaste({
  building,
  buildingId,
  refresh,
}: {
  building?: EvaluatedBuilding;
  buildingId?: string;
  refresh: () => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [mode, setMode] = useState<"keep" | "merge">("keep"),
    [plan, setPlan] = useState<PastePlan | null>(null),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const template = JSON.stringify(
    buildingId ? { units: jsonTemplate.units } : jsonTemplate,
    null,
    2,
  );
  const cancel = "#" + (buildingId ? "detail/" + buildingId : "buildings");
  function invalidate() {
    setPlan(null);
    setPreview(false);
    setNotice("");
    setError("");
  }
  async function check(showPreview: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await request("preview", {
        text,
        building_id: buildingId,
        mode,
      });
      setPlan(next);
      setPreview(showPreview);
      setNotice(
        showPreview
          ? ""
          : "Valid JSON. Click Preview to review the changes before saving.",
      );
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
      setPreview(false);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!plan || !preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await request("save", {
        text,
        building_id: buildingId,
        mode,
        token: plan.token,
      });
      setPlan(null);
      setPreview(false);
      await refresh();
      window.location.hash = "detail/" + result.building_id;
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
      setPreview(false);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(template);
      setNotice("JSON template copied. Replace example values before saving.");
    } catch {
      setError(
        "Clipboard unavailable. Open Show JSON Format and copy the example manually.",
      );
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <h1>
            {buildingId ? "Add / Update via JSON" : "Paste JSON"}
            {building ? " — " + building.name : ""}
          </h1>
          <p className="muted">
            Add or update supplied records. Existing inventory and review
            decisions stay attached to the building.
          </p>
        </div>
        <a className="button" href={cancel}>
          Cancel
        </a>
      </div>
      <section>
        <div className="actions">
          <button type="button" onClick={copy}>
            Copy JSON Template
          </button>
          <details className="json-format">
            <summary>Show JSON Format</summary>
            <p>
              Supply a building globally, or just units from a building page.
              Units may be empty. Use null for unknown numbers and dates; omit
              optional fields to preserve existing values. Notes are appended,
              aliases combined. Workflow decision fields are not accepted.
            </p>
            <pre>{template}</pre>
          </details>
        </div>
        <label className="json-paste-label">
          Paste apartment JSON
          <textarea
            className="json-paste-input"
            spellCheck={false}
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              invalidate();
            }}
            placeholder={template}
          />
        </label>
        <div className="actions">
          <button disabled={busy || !text.trim()} onClick={() => check(false)}>
            Validate
          </button>
          <button disabled={busy || !text.trim()} onClick={() => check(true)}>
            Preview
          </button>
          <button
            className="primary"
            disabled={busy || !preview || !plan}
            onClick={save}
          >
            {busy ? "Working…" : "Save"}
          </button>
          <a className="button" href={cancel}>
            Cancel
          </a>
        </div>
        {error && (
          <p role="alert" className="error prewrap">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}
      </section>
      {plan?.existing && (
        <section className="duplicate">
          <h2>EXISTING BUILDING FOUND</h2>
          <h3>{plan.existing.name}</h3>
          <p>{plan.existing.address}</p>
          <p>
            Current status:{" "}
            <strong
              className={"badge " + plan.existing.final_status.toLowerCase()}
            >
              {plan.existing.final_status}
            </strong>
          </p>
          {plan.existing.final_status === "REJECTED" && (
            <p className="error">
              Reason:{" "}
              {plan.existing.rejection_reason ||
                plan.existing.failures.join("; ")}
            </p>
          )}
          <p className="prewrap">
            {plan.existing.notes || "No previous notes."}
          </p>
          <label>
            Existing building facts
            <select
              value={mode}
              disabled={busy}
              onChange={(event) => {
                setMode(event.target.value as "keep" | "merge");
                setPreview(false);
                setNotice("Choice changed. Preview again before saving.");
              }}
            >
              <option value="keep">
                Keep existing building facts and only add/update units
              </option>
              <option value="merge">
                Merge supplied building facts into the existing building
              </option>
            </select>
          </label>
          <p className="muted">
            Manual status, rejection reason, toured/finalist/signed states and
            historical notes are preserved. Omitted units are never deleted or
            deactivated.
          </p>
        </section>
      )}
      {preview && plan && (
        <section>
          <h2>Review before saving</h2>
          <h3>{plan.building.name}</h3>
          <p>
            {plan.building.address} ·{" "}
            {plan.building.neighborhood || "Neighborhood unknown"}
          </p>
          <p>
            Duplicate status:{" "}
            {plan.existing ? "EXISTING BUILDING FOUND" : "NEW BUILDING"} ·{" "}
            {plan.mode === "keep" && plan.existing
              ? "Building facts kept"
              : "Supplied building facts applied"}
          </p>
          {!!plan.building_changes.length && (
            <details>
              <summary>Building facts to save</summary>
              <Diff changes={plan.building_changes} />
            </details>
          )}
          <div className="metrics">
            <span>
              Building score
              <strong>{plan.evaluation.building_score.toFixed(1)}</strong>
            </span>
            <span>
              Opportunity score
              <strong>
                {plan.evaluation.opportunity_score?.toFixed(1) ?? "—"}
              </strong>
            </span>
            <span>
              Auto status<strong>{plan.evaluation.auto_status}</strong>
            </span>
            <span>
              Final status<strong>{plan.evaluation.final_status}</strong>
            </span>
            <span>
              Projected rank
              <strong>{plan.rank ?? "Outside active ranking"}</strong>
            </span>
          </div>
          {[...plan.evaluation.failures, ...plan.evaluation.unresolved].length >
            0 && (
            <p className="notice">
              {[
                ...plan.evaluation.failures,
                ...plan.evaluation.unresolved,
              ].join("; ")}
            </p>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Unit #",
                    "Action",
                    "Sqft",
                    "Rent",
                    "Parking",
                    "Available date",
                    "Lease",
                    "Hard filter result",
                    "Score",
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.units.map((unit, index) => (
                  <tr key={index}>
                    <td>{unit.after.unit_number || "Unnamed"}</td>
                    <td>{unit.classification}</td>
                    <td>{unit.after.sqft ?? "Unknown"}</td>
                    <td>{money(unit.after.base_rent)}</td>
                    <td>{money(unit.after.parking_cost)}</td>
                    <td>{unit.after.available_date ?? "Unknown"}</td>
                    <td>{unit.after.lease_length_months ?? "Unknown"}</td>
                    <td>
                      {unit.evaluation.passes_hard_filters
                        ? "PASS"
                        : unit.evaluation.hard_fail_reasons.length
                          ? "FAIL"
                          : "UNRESOLVED"}
                    </td>
                    <td>{unit.evaluation.unit_score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!plan.units.length && (
            <p>No supplied units. Existing inventory is unchanged.</p>
          )}
          {plan.units.map((unit, index) => (
            <div className="paste-unit-review" key={index}>
              <h3>
                Unit #{unit.after.unit_number || "Unnamed"} ·{" "}
                {unit.classification}
              </h3>
              {unit.classification === "UNNUMBERED UNIT" && (
                <p className="notice">
                  Reliable deduplication is not possible without a unit number.
                  This creates a separate unit.
                </p>
              )}
              {unit.existing_id &&
                (unit.changes.length ? (
                  <Diff changes={unit.changes} />
                ) : (
                  <p>No supplied values changed.</p>
                ))}
              {[
                ...unit.evaluation.hard_fail_reasons,
                ...unit.evaluation.unresolved,
                ...unit.evaluation.warnings,
              ].map((reason, i) => (
                <p className="muted" key={i}>
                  {reason}
                </p>
              ))}
            </div>
          ))}
          <p className="muted">
            Save applies every supplied unit together. Existing unit identities
            and histories are retained.
          </p>
          <button className="primary" disabled={busy} onClick={save}>
            Save
          </button>
        </section>
      )}
    </>
  );
}
function Diff({ changes }: { changes: PastePlan["building_changes"] }) {
  return (
    <ul className="paste-diff">
      {changes.map((change) => (
        <li key={change.field}>
          <strong>{change.field}</strong>:{" "}
          <span>{display(change.field, change.before)}</span> →{" "}
          <span>{display(change.field, change.after)}</span>
        </li>
      ))}
    </ul>
  );
}
