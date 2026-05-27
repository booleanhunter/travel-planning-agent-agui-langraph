/**
 * MCP elicitation request shapes.
 *
 * Subset of JSON Schema allowed in MCP elicitation `requestedSchema`.
 * Per spec: flat objects with primitive properties only — no nested objects.
 * Allowed: string (with format), number/integer, boolean, enum (single via
 * enum/oneOf), array of enums (multi via items.enum/items.anyOf).
 *
 * Hand-maintained TS to match the MCP spec — not Zod-first because we're
 * mirroring an external spec we don't author.
 */

export type ElicitStringSchema = {
    type: 'string';
    title?: string;
    description?: string;
    format?: 'email' | 'uri' | 'date' | 'date-time';
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    default?: string;
    enum?: string[];
    oneOf?: Array<{ const: string; title?: string }>;
};

export type ElicitNumberSchema = {
    type: 'number' | 'integer';
    title?: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    default?: number;
};

export type ElicitBooleanSchema = {
    type: 'boolean';
    title?: string;
    description?: string;
    default?: boolean;
};

export type ElicitArrayEnumSchema = {
    type: 'array';
    title?: string;
    description?: string;
    items: {
        type?: 'string';
        enum?: string[];
        anyOf?: Array<{ const: string; title?: string }>;
    };
    minItems?: number;
    maxItems?: number;
    default?: string[];
};

export type ElicitPrimitiveSchema =
    | ElicitStringSchema
    | ElicitNumberSchema
    | ElicitBooleanSchema
    | ElicitArrayEnumSchema;

/**
 * Form-mode elicit — chip card. JSON-Schema fields rendered as inputs.
 * Same shape MCP's spec uses for `ElicitRequestFormParams`.
 */
export interface FormElicitSpec {
    mode: 'form';
    message: string;
    requestedSchema: {
        type: 'object';
        properties: Record<string, ElicitPrimitiveSchema>;
        required?: string[];
    };
}

/**
 * URL-mode elicit — opens an external URL (e.g. OAuth consent) and the
 * client signals back when the out-of-band flow completes. Matches MCP's
 * `ElicitRequestURLParams` shape.
 *
 * In AG-UI: the React app opens `url` in a new tab; the OAuth callback
 * page posts a message to `window.opener` with the matching
 * `elicitationId`; the React app then auto-resubmits the original turn.
 *
 * In MCP: the MCP client opens the URL natively; our server awaits the
 * in-process deferred resolved by `/oauth/google/callback`.
 */
export interface URLElicitSpec {
    mode: 'url';
    message: string;
    url: string;
    elicitationId: string;
}

export type ElicitSpec = FormElicitSpec | URLElicitSpec;
