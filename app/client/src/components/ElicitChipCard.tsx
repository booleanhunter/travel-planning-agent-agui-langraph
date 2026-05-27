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
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onCancel]);

    const setValue = (name: string, value: unknown) =>
        setValues((prevValues) => ({ ...prevValues, [name]: value }));

    // Whether any property has a meaningful value — controls Continue disabled state.
    const hasAnyValue = Object.entries(spec.requestedSchema.properties).some(([name]) => {
        const value = values[name];
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return true;
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
                    onChange={(value) => setValue(name, value)}
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
    onChange: (value: unknown) => void;
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
    onChange: (value: unknown) => void,
) {
    // Single-select string enum (via oneOf or plain enum)
    if (schema.type === 'string' && (schema.oneOf || schema.enum)) {
        const options = schema.oneOf
            ? schema.oneOf.map((entry) => ({ value: entry.const, label: entry.title ?? entry.const }))
            : (schema.enum ?? []).map((enumValue) => ({ value: enumValue, label: enumValue }));
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
                onChange={(event) => onChange(event.target.value)}
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
                onChange={(event) => onChange(event.target.value)}
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
                onChange={(event) =>
                    onChange(event.target.value === '' ? undefined : Number(event.target.value))
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
                onChange={(event) => onChange(event.target.checked)}
            />
        );
    }

    // Multi-select array of enums (items.enum or items.anyOf)
    if (schema.type === 'array') {
        const items = schema.items;
        const options = items.anyOf
            ? items.anyOf.map((entry) => ({ value: entry.const, label: entry.title ?? entry.const }))
            : (items.enum ?? []).map((enumValue) => ({ value: enumValue, label: enumValue }));
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
                                        ? current.filter((existing) => existing !== opt.value)
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
