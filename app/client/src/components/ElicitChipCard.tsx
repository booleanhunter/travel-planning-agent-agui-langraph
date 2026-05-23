import { useState, useEffect, useMemo } from "react";
import type { ElicitSpec } from "../types";

interface Props {
  spec: ElicitSpec;
  onSubmit: (values: Record<string, unknown>) => void;
}

export function ElicitChipCard({ spec, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  // Initialize defaults from the spec on first render
  useEffect(() => {
    const initial: Record<string, unknown> = {};
    for (const f of spec.fields) {
      if (f.default !== undefined) initial[f.name] = f.default;
    }
    setValues(initial);
  }, [spec]);

  const fromMemoryBanner = useMemo(
    () => spec.fields.some((f) => f.prefilledFromMemory),
    [spec],
  );

  const setValue = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));

  // Whether any field has a meaningful value — controls Continue button disabled state.
  const hasAnyValue = spec.fields.some((field) => {
    const v = values[field.name];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") {
      const dr = v as { start?: string; end?: string };
      return !!(dr.start && dr.end);  // date-range requires both ends filled
    }
    return false;
  });

  const handleSubmit = () => onSubmit(values);

  return (
    <div className="elicit-card">
      <p className="elicit-message">{spec.message}</p>
      {fromMemoryBanner && (
        <div className="elicit-banner">Some defaults prefilled from your past trips.</div>
      )}

      {spec.fields.map((field) => (
        <div key={field.name} className="elicit-field">
          <label>
            {field.label}
            {field.prefilledFromMemory && <span className="from-memory">from memory</span>}
          </label>
          {field.helpText && <div className="elicit-help">{field.helpText}</div>}

          {field.type === "enum" && (
            <div className="elicit-chips">
              {field.options?.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`elicit-chip ${values[field.name] === opt.value ? "selected" : ""}`}
                  onClick={() => setValue(field.name, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {field.type === "multi-enum" && (
            <div className="elicit-chips">
              {field.options?.map((opt) => {
                const current = (values[field.name] as string[] | undefined) ?? [];
                const selected = current.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`elicit-chip ${selected ? "selected" : ""}`}
                    onClick={() =>
                      setValue(
                        field.name,
                        selected ? current.filter((v) => v !== opt.value) : [...current, opt.value],
                      )
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {field.type === "date-range" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="date"
                className="elicit-date"
                value={(values[field.name] as { start?: string } | undefined)?.start ?? ""}
                onChange={(e) =>
                  setValue(field.name, {
                    ...(values[field.name] as object | undefined),
                    start: e.target.value,
                  })
                }
              />
              <span style={{ alignSelf: "center", color: "var(--text-soft)" }}>→</span>
              <input
                type="date"
                className="elicit-date"
                value={(values[field.name] as { end?: string } | undefined)?.end ?? ""}
                onChange={(e) =>
                  setValue(field.name, {
                    ...(values[field.name] as object | undefined),
                    end: e.target.value,
                  })
                }
              />
            </div>
          )}

          {field.type === "string" && (
            <input
              type="text"
              className="elicit-date"
              value={(values[field.name] as string | undefined) ?? ""}
              onChange={(e) => setValue(field.name, e.target.value)}
              style={{ width: "100%" }}
            />
          )}
        </div>
      ))}

      <button
        type="button"
        className="elicit-submit"
        onClick={handleSubmit}
        disabled={!hasAnyValue}
      >
        Continue
      </button>
    </div>
  );
}
