/**
 * Elicit request shapes — mirrors server/src/modules/ai/itinerary-workflow/elicit.ts.
 *
 * Surfaced through the `requestTripBasicsFromUser` tool's `interrupt(payload)`
 * call. CopilotKit's `useInterrupt` hook receives this payload as `event.value`
 * and hands it to `InlineVariableChips` for rendering.
 */

export interface ElicitOption {
    value: string;
    label: string;
    description?: string;
}

export interface ElicitField {
    key: 'destination' | 'dates' | 'interests';
    label: string;
    helpText?: string;
    inputType: 'text' | 'chip-group' | 'date-range';
    options?: ElicitOption[];
    prefilled?: string | string[];
    prefilledFromMemory?: boolean;
    optional?: boolean;
    multi?: boolean;
}

export interface ElicitRequest {
    type: 'elicit_request';
    schemaId: string;
    prompt: string;
    fields: ElicitField[];
    warning?: string;
}
