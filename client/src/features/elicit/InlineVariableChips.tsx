/**
 * InlineVariableChips — renders the Phase 1 elicit_request schema.
 *
 * Renders only the fields the server flagged as still-missing. Fields can
 * carry a `helpText`, `description` per option, and `optional` flag. A
 * `warning` on the payload (e.g. "you said 3 days but dates span 5") is
 * surfaced above the fields.
 */

import { useMemo, useState } from 'react';
import type { ElicitRequest, ElicitField } from './types.ts';

interface Props {
    request: ElicitRequest;
    submitted?: Record<string, unknown>;
    declined?: boolean;
    onSubmit: (values: Record<string, unknown>) => void;
    onDecline?: () => void;
}

export function InlineVariableChips({ request, submitted, declined, onSubmit, onDecline }: Props) {
    const initial = useMemo(() => {
        const seed: Record<string, unknown> = {};
        for (const f of request.fields) {
            // Multi-select chip-groups carry string[]; everything else is scalar.
            // An empty prefilled array still counts as "no seed" so the user
            // sees fresh chips rather than a meaningless empty selection.
            if (Array.isArray(f.prefilled) ? f.prefilled.length : f.prefilled) {
                seed[f.key] = f.prefilled;
            }
        }
        return seed;
    }, [request]);

    const [values, setValues] = useState<Record<string, unknown>>(initial);
    const isLocked = Boolean(submitted) || Boolean(declined);
    const hasMemoryPrefill = request.fields.some((f) => f.prefilledFromMemory);

    const setField = (key: string, value: unknown) =>
        setValues((prev) => ({ ...prev, [key]: value }));

    const canSubmit =
        !isLocked &&
        request.fields.every((f) => {
            if (f.optional) return true;
            const v = (submitted ?? values)[f.key];
            return v !== undefined && v !== '' && v !== null;
        });

    return (
        <div className={`elicit-card${isLocked ? ' is-locked' : ''}`}>
            {hasMemoryPrefill && (
                <div className="elicit-memory-banner" role="status">
                    <i className="ti ti-history" aria-hidden="true" />
                    <span>Some defaults prefilled from your past trips</span>
                </div>
            )}

            {request.warning && (
                <div className="elicit-warning" role="alert">
                    <i className="ti ti-alert-triangle" aria-hidden="true" />
                    <span>{request.warning}</span>
                </div>
            )}

            {request.prompt && <p className="elicit-prompt">{request.prompt}</p>}

            <div className="elicit-fields">
                {request.fields.map((field) => (
                    <FieldRow
                        key={field.key}
                        field={field}
                        value={submitted ? submitted[field.key] : values[field.key]}
                        onChange={(v) => setField(field.key, v)}
                        disabled={isLocked}
                    />
                ))}
            </div>

            <div className="elicit-actions">
                {onDecline && !isLocked && (
                    <button type="button" className="btn-ghost" onClick={onDecline}>
                        Skip
                    </button>
                )}
                <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onSubmit(values)}
                    disabled={!canSubmit}
                >
                    {declined ? 'Skipped' : isLocked ? 'Submitted' : 'Continue'}
                </button>
            </div>
        </div>
    );
}

interface FieldRowProps {
    field: ElicitField;
    value: unknown;
    onChange: (v: unknown) => void;
    disabled?: boolean;
}

function FieldRow({ field, value, onChange, disabled }: FieldRowProps) {
    return (
        <div className="elicit-field">
            <label className="elicit-field-label">
                <span>{field.label}</span>
                {field.prefilledFromMemory && (
                    <i className="ti ti-history elicit-memory-icon" aria-label="from memory" />
                )}
            </label>
            {field.helpText && <p className="elicit-field-help">{field.helpText}</p>}
            {renderControl(field, value, onChange, disabled)}
        </div>
    );
}

function renderControl(
    field: ElicitField,
    value: unknown,
    onChange: (v: unknown) => void,
    disabled?: boolean,
) {
    if (field.inputType === 'chip-group') {
        const multi = !!field.multi;
        const selectedValues = multi
            ? new Set(Array.isArray(value) ? (value as string[]) : [])
            : new Set(value != null ? [String(value)] : []);
        const toggle = (optValue: string) => {
            if (disabled) return;
            if (multi) {
                const next = new Set(selectedValues);
                if (next.has(optValue)) next.delete(optValue);
                else next.add(optValue);
                onChange(Array.from(next));
            } else {
                onChange(optValue);
            }
        };
        return (
            <div
                className={`chip-group${multi ? ' is-multi' : ''}`}
                role={multi ? 'group' : 'radiogroup'}
            >
                {(field.options ?? []).map((opt) => {
                    const selected = selectedValues.has(opt.value);
                    const role = multi ? 'checkbox' : 'radio';
                    const ariaProp = multi
                        ? { 'aria-checked': selected }
                        : { 'aria-checked': selected };
                    return (
                        <button
                            type="button"
                            key={opt.value}
                            role={role}
                            {...ariaProp}
                            className={`chip${selected ? ' is-selected' : ''}`}
                            onClick={() => toggle(opt.value)}
                            disabled={disabled}
                            title={opt.description}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    if (field.inputType === 'text') {
        return (
            <input
                type="text"
                className="elicit-text"
                value={(value as string) ?? ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                placeholder={field.label}
            />
        );
    }

    if (field.inputType === 'date-range') {
        const v = (value as { start?: string; end?: string }) ?? {};
        return (
            <div className="date-range">
                <input
                    type="date"
                    value={v.start ?? ''}
                    onChange={(e) => onChange({ ...v, start: e.target.value })}
                    disabled={disabled}
                />
                <span aria-hidden="true">→</span>
                <input
                    type="date"
                    value={v.end ?? v.start ?? ''}
                    onChange={(e) => onChange({ ...v, end: e.target.value })}
                    disabled={disabled}
                />
            </div>
        );
    }

    return null;
}
