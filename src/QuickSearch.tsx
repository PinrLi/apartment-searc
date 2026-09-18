import { useEffect, useMemo, useRef, useState } from "react";
import type { EvaluatedBuilding } from "../shared/engine";
import {
  createBuildingSearchIndex,
  searchBuildingIndex,
} from "../shared/search";

export function QuickSearch({
  buildings,
  loading,
  route,
}: {
  buildings: EvaluatedBuilding[];
  loading: boolean;
  route: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const index = useMemo(
    () => createBuildingSearchIndex(buildings),
    [buildings],
  );
  const matches = useMemo(
    () => searchBuildingIndex(index, query),
    [index, query],
  );
  const results = matches.slice(0, 20);
  const active = Math.min(selected, Math.max(0, results.length - 1));
  const visible = open && Boolean(query.trim());

  useEffect(() => {
    setOpen(false);
  }, [route]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      const editing = element?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      );
      if (event.isComposing || event.altKey) return;
      if (
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
        (event.key === "/" && !event.ctrlKey && !event.metaKey && !editing)
      ) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", shortcut);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", shortcut);
      document.removeEventListener("pointerdown", outside);
    };
  }, []);
  useEffect(() => {
    if (visible)
      root.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [active, visible, query]);

  function navigate(destination: string) {
    window.location.hash = destination;
    setOpen(false);
    input.current?.blur();
  }

  return (
    <div
      className="quick-search"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label htmlFor="quick-apartment-search">
        Quick Apartment Search <kbd>/</kbd> <kbd>Ctrl/⌘ K</kbd>
      </label>
      <input
        id="quick-apartment-search"
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? "quick-apartment-results" : undefined}
        aria-activedescendant={
          visible && results.length
            ? `quick-result-${results[active].id}`
            : undefined
        }
        autoComplete="off"
        placeholder="Already reviewed? Name, alias, or address…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setSelected(
              !visible
                ? 0
                : results.length
                  ? (active +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      results.length) %
                    results.length
                  : 0,
            );
          } else if (event.key === "Enter" && visible && !loading) {
            event.preventDefault();
            navigate(results.length ? "detail/" + results[active].id : "add");
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      />
      {visible && (
        <div className="quick-popover">
          <div className="quick-summary" role="status">
            {loading
              ? "Loading your buildings…"
              : matches.length
                ? `${matches.length} existing building${matches.length === 1 ? "" : "s"}${matches.length > 20 ? " · showing first 20; refine your search" : ""}`
                : "No existing apartment found"}
          </div>
          <div
            id="quick-apartment-results"
            role="listbox"
            aria-label="Existing buildings"
          >
            {results.map((building, position) => (
              <a
                key={building.id}
                id={`quick-result-${building.id}`}
                href={"#detail/" + building.id}
                role="option"
                aria-selected={active === position}
                tabIndex={-1}
                className={
                  "quick-result" +
                  (building.final_status === "REJECTED"
                    ? " quick-rejected"
                    : "")
                }
                onMouseEnter={() => setSelected(position)}
                onClick={(event) => {
                  event.preventDefault();
                  navigate("detail/" + building.id);
                }}
              >
                <div className="quick-result-title">
                  <strong>{building.name}</strong>
                  <span className="quick-open">Open →</span>
                </div>
                <div>{building.address}</div>
                <small>{building.neighborhood || "Neighborhood unknown"}</small>
                <div className="quick-result-status">
                  <span
                    className={"badge " + building.final_status.toLowerCase()}
                  >
                    {building.final_status}
                  </span>
                  <span>
                    Score{" "}
                    {(
                      building.opportunity_score ?? building.building_score
                    ).toFixed(1)}{" "}
                    <small className="quick-score-type">
                      (
                      {building.opportunity_score === null
                        ? "building"
                        : "opportunity"}
                      )
                    </small>
                  </span>
                </div>
                <small>
                  Last reviewed{" "}
                  {building.last_reviewed_date
                    ? new Date(building.last_reviewed_date).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric", year: "numeric" },
                      )
                    : "Unknown"}
                </small>
                {building.final_status === "REJECTED" && (
                  <p className="quick-reason">
                    <strong>Reason:</strong>{" "}
                    {building.rejection_reason ||
                      building.failures.join("; ") ||
                      "No reason recorded"}
                  </p>
                )}
                <p className="quick-notes">
                  {building.notes
                    ? building.notes.replace(/\s+/g, " ").slice(0, 160) +
                      (building.notes.length > 160 ? "…" : "")
                    : "No notes recorded."}
                </p>
              </a>
            ))}
          </div>
          {!loading && !matches.length && (
            <a
              className="button primary"
              href="#add"
              onClick={(event) => {
                event.preventDefault();
                navigate("add");
              }}
            >
              Add New Apartment
            </a>
          )}
        </div>
      )}
    </div>
  );
}
