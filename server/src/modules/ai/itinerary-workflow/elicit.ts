/**
 * Elicitation request shape + builder.
 *
 * Used by `requestTripBasicsFromUser` (the tool) to construct an `ElicitRequest`
 * before pausing the graph via `interrupt(elicit)`. The runtime adapter
 * (CopilotKit / MCP) reads the payload from `graph.getState().tasks[].interrupts`
 * and translates it onto its surface event.
 *
 * `ElicitRequest` is also declared on `ItineraryState.pendingElicitation` for
 * REST-only introspection of "what is the agent waiting on?" — see
 * `state.ts` for the field-level note.
 */

export interface ElicitField {
    key: 'destination' | 'dates' | 'interests';
    label: string;
    helpText?: string;
    inputType: 'text' | 'chip-group' | 'date-range';
    options?: Array<{ value: string; label: string; description?: string }>;
    // For single-select chip-groups / text / date-range this is a scalar;
    // for multi-select chip-groups (`multi: true`) it's a string[].
    prefilled?: string | string[];
    prefilledFromMemory?: boolean;
    optional?: boolean;
    // chip-group only: allow multiple selections (chips behave as checkboxes).
    multi?: boolean;
}

export interface ElicitRequest {
    type: 'elicit_request';
    schemaId: string;
    prompt: string;
    fields: ElicitField[];
}

// Canonical interest chips — multi-select. The LLM is welcome to use free-form
// descriptors (e.g. "moody", "indie") when calling search; this list is just
// the chip vocabulary the UI knows how to render selected.
export const INTEREST_OPTIONS: NonNullable<ElicitField['options']> = [
    { value: 'food', label: 'Food & restaurants', description: 'Restaurants, markets, cooking' },
    { value: 'landmarks', label: 'Famous landmarks', description: 'Postcard must-sees' },
    {
        value: 'hidden',
        label: 'Off the beaten path',
        description: 'Locals’ picks, hidden gems',
    },
    { value: 'slow', label: 'Slow & easygoing', description: 'Cafés, parks, gentle walks' },
    { value: 'outdoors', label: 'Outdoors & nature', description: 'Hiking, parks, water' },
    { value: 'nightlife', label: 'Nightlife & social', description: 'Bars, music, late nights' },
    { value: 'arts', label: 'Arts & culture', description: 'Museums, galleries, performance' },
];

/**
 * Build an `ElicitRequest` for whichever trip basics the agent is missing.
 *
 * Field order mirrors the chip card's reading order (where → when → vibe).
 * `dates` and `interests` are marked optional so the user can skip them; the
 * agent then plans with what it has (date-flexible / broad-interest defaults).
 */
export function buildTripBasicsElicit(
    missing: ReadonlyArray<'destination' | 'dates' | 'interests'>,
): ElicitRequest {
    const fields: ElicitField[] = [];

    if (missing.includes('destination')) {
        fields.push({
            key: 'destination',
            label: 'Where to?',
            helpText: 'A city or region — Bangalore, Tokyo, the Amalfi coast…',
            inputType: 'text',
        });
    }

    if (missing.includes('dates')) {
        fields.push({
            key: 'dates',
            label: 'When are you going?',
            helpText:
                'Pick the dates — I’ll work out the day-by-day plan from there. Skip if you’re flexible.',
            inputType: 'date-range',
            optional: true,
        });
    }

    if (missing.includes('interests')) {
        fields.push({
            key: 'interests',
            label: 'What are you in the mood for?',
            helpText: 'Pick a few (or skip and I’ll go broad).',
            inputType: 'chip-group',
            multi: true,
            options: INTEREST_OPTIONS,
            optional: true,
        });
    }

    return {
        type: 'elicit_request',
        schemaId: 'trip_basics',
        prompt:
            fields.length === 1
                ? 'Just one more thing:'
                : 'A few quick details so I can build your day:',
        fields,
    };
}
