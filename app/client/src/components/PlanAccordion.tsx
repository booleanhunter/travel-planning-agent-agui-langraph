import type { ReactNode, MouseEvent } from 'react';
import type { POI } from '../types';

interface Props {
    /** The staged picks (what's checked + visible in the strip). */
    picked: POI[];
    /** × on a strip pin — purely local unstage. */
    onRemovePick: (poiId: string) => void;
    onSave: () => void;
    saving: boolean;
    savedAt: string | null;
    /** True when the user has committed picks AND staged == committed (no pending changes). */
    canMarkComplete: boolean;
    /** Called when the user clicks "Update plan" — submits the staged picks as a turn. */
    onUpdatePlan: () => void;
    /** True when staged differs from committed (something to update). */
    canUpdatePlan: boolean;
    /** The POI grid (or anything else) goes inside the accordion body. */
    children: ReactNode;
}

const stop = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
};

export function PlanAccordion({
    picked,
    onRemovePick,
    onSave,
    saving,
    savedAt,
    canMarkComplete,
    onUpdatePlan,
    canUpdatePlan,
    children,
}: Props) {
    const saveLabel = saving ? 'Saving…' : savedAt ? `Completed at ${savedAt}` : 'Mark as complete';

    return (
        <details className="plan-disclosure" open>
            <summary>
                <div className="plan-summary">
                    <div className="plan-summary-top">
                        <h3 className="plan-summary-title">Your plan</h3>
                        <span className="plan-summary-meta">Pick from the places below</span>
                        <div className="plan-summary-spacer" />
                        <button
                            type="button"
                            className="update-plan"
                            onClick={(event) => {
                                stop(event);
                                onUpdatePlan();
                            }}
                            disabled={!canUpdatePlan}
                        >
                            Update plan
                        </button>
                        <button
                            type="button"
                            className="save-trip"
                            onClick={(event) => {
                                stop(event);
                                onSave();
                            }}
                            disabled={!canMarkComplete || saving}
                        >
                            {saveLabel}
                        </button>
                        <span className="disclosure-chevron">▸</span>
                    </div>

                    {picked.length > 0 && (
                        <ol className="plan-strip">
                            {picked.map((poi) => (
                                <li key={poi.id} className="plan-pin">
                                    <span className="plan-pin-name">{poi.name}</span>
                                    <button
                                        type="button"
                                        className="plan-pin-x"
                                        aria-label={`Remove ${poi.name}`}
                                        onClick={(event) => {
                                            stop(event);
                                            onRemovePick(poi.id);
                                        }}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </summary>

            <div className="plan-disclosure-body">{children}</div>
        </details>
    );
}
