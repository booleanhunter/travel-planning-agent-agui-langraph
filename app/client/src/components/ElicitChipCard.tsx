import { useState, useEffect } from 'react';
import type { ElicitPrimitiveSchema, ElicitSpec } from '../types';

interface Props {
    spec: ElicitSpec;
    /** action: accept — user submitted the form with values. */
    onSubmit: (values: Record<string, unknown>) => void;
    /** action: decline — user explicitly chose to skip; continue without these. */
    onDecline?: () => void;
    /** action: cancel — user dismissed (Esc / outside click). Quiet end of turn. */
    onCancel?: () => void;
}

export function ElicitChipCard({ spec, onSubmit, onDecline, onCancel }: Props) {
    const [values, setValues] = useState<Record<string, unknown>>({});

    // Initialize defaults from the schema on first render.
    useEffect(() => {
        const initial: Record<string, unknown> = {};
        for (const [name, schema] of Object.entries(spec.requestedSchema.properties)) {
            if ('default' in schema && schema.default !== undefined) {
                initial[name] = schema.default;
            }
        }
        setValues(initial);
    }, [spec]);

    // Esc key → cancel action.
    useEffect(() => {
        if (!onCancel) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onCancel]);

    const setValue = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));

    // Whether any property has a meaningful value — controls Continue disabled state.
    const hasAnyValue = Object.entries(spec.requestedSchema.properties).some(([name]) => {
        const v = values[name];
        if (v === undefined || v === null) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return true;
        return false;
    });

    const handleSubmit = () => onSubmit(values);

    return (
        <div className="elicit-card">
            <p className="elicit-message">{spec.message}</p>

            {Object.entries(spec.requestedSchema.properties).map(([name, schema]) => (
                <FieldRenderer
                    key={name}
                    name={name}
                    schema={schema}
                    value={values[name]}
                    onChange={(v) => setValue(name, v)}
                />
            ))}

            <div className="elicit-actions">
                {onDecline && (
                    <button type="button" className="elicit-decline" onClick={onDecline}>
                        Skip
                    </button>
                )}
                <button
                    type="button"
                    className="elicit-submit"
                    onClick={handleSubmit}
                    disabled={!hasAnyValue}
                >
                    Continue
                </button>
            </div>
        </div>
    );
}

interface FieldProps {
    name: string;
    schema: ElicitPrimitiveSchema;
    value: unknown;
    onChange: (v: unknown) => void;
}

function FieldRenderer({ schema, value, onChange }: FieldProps) {
    const title = schema.title ?? '';
    const description = schema.description;

    return (
        <div className="elicit-field">
            <label>{title}</label>
            {description && <div className="elicit-help">{description}</div>}
            {renderInput(schema, value, onChange)}
        </div>
    );
}

function renderInput(
    schema: ElicitPrimitiveSchema,
    value: unknown,
    onChange: (v: unknown) => void,
) {
    // Single-select string enum (via oneOf or plain enum)
    if (schema.type === 'string' && (schema.oneOf || schema.enum)) {
        const options = schema.oneOf
            ? schema.oneOf.map((o) => ({ value: o.const, label: o.title ?? o.const }))
            : (schema.enum ?? []).map((v) => ({ value: v, label: v }));
        return (
            <div className="elicit-chips">
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        className={`elicit-chip ${value === opt.value ? 'selected' : ''}`}
                        onClick={() => onChange(opt.value)}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        );
    }

    // String with format: date → date input
    if (schema.type === 'string' && schema.format === 'date') {
        return (
            <input
                type="date"
                className="elicit-date"
                value={(value as string | undefined) ?? ''}
                onChange={(e) => onChange(e.target.value)}
            />
        );
    }

    // Plain string → text input
    if (schema.type === 'string') {
        return (
            <input
                type="text"
                className="elicit-date"
                value={(value as string | undefined) ?? ''}
                onChange={(e) => onChange(e.target.value)}
                style={{ width: '100%' }}
            />
        );
    }

    // Number / integer
    if (schema.type === 'number' || schema.type === 'integer') {
        return (
            <input
                type="number"
                className="elicit-date"
                value={(value as number | undefined) ?? ''}
                min={schema.minimum}
                max={schema.maximum}
                onChange={(e) =>
                    onChange(e.target.value === '' ? undefined : Number(e.target.value))
                }
            />
        );
    }

    // Boolean → checkbox
    if (schema.type === 'boolean') {
        return (
            <input
                type="checkbox"
                checked={(value as boolean | undefined) ?? false}
                onChange={(e) => onChange(e.target.checked)}
            />
        );
    }

    // Multi-select array of enums (items.enum or items.anyOf)
    if (schema.type === 'array') {
        const items = schema.items;
        const options = items.anyOf
            ? items.anyOf.map((o) => ({ value: o.const, label: o.title ?? o.const }))
            : (items.enum ?? []).map((v) => ({ value: v, label: v }));
        const current = (value as string[] | undefined) ?? [];
        return (
            <div className="elicit-chips">
                {options.map((opt) => {
                    const selected = current.includes(opt.value);
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            className={`elicit-chip ${selected ? 'selected' : ''}`}
                            onClick={() =>
                                onChange(
                                    selected
                                        ? current.filter((v) => v !== opt.value)
                                        : [...current, opt.value],
                                )
                            }
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    return null;
}
