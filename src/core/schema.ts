// A minimal, dependency-free runtime schema/validator for scene parameters.
//
// This is a tiny local alternative to libraries like Zod: a schema is a plain
// record of field specs, and `parse` validates an input object against it,
// filling defaults, enforcing types / ranges / enums, and rejecting unknown
// keys with clear, single-line error messages (matching the validation style
// used elsewhere in the codebase, e.g. plugins/manifest.ts and plugins/expr.ts).
//
// Nothing here is node-specific, so both this module and its consumers stay
// importable in the browser as well as Node.

export type FieldType = "string" | "number" | "boolean" | "color" | "enum";

export interface FieldSpec {
  type: FieldType;
  default?: any;
  optional?: boolean;
  min?: number; // for number
  max?: number; // for number
  values?: string[]; // for enum
  description?: string;
}

export type SchemaSpec = Record<string, FieldSpec>;

export interface Schema<T = Record<string, any>> {
  spec: SchemaSpec;
  /** Validate + fill defaults. Throws an Error on the first problem found. */
  parse(input: Record<string, any>): T;
  /** Non-throwing variant of `parse`. */
  safeParse(input: Record<string, any>): { ok: true; value: T } | { ok: false; error: string };
}

// Lenient color check: a hex string (#rgb .. #rrggbbaa, with or without '#')
// or any other non-empty string (to allow CSS color names like "red").
const HEX_RE = /^#?[0-9a-fA-F]{3,8}$/;

// ---------------------------------------------------------------------------
// Per-field validation.
// ---------------------------------------------------------------------------
function validateField(key: string, spec: FieldSpec, value: any): any {
  switch (spec.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`field '${key}': expected a finite number`);
      }
      if (spec.min !== undefined && value < spec.min) {
        throw new Error(`field '${key}': must be >= ${spec.min} (got ${value})`);
      }
      if (spec.max !== undefined && value > spec.max) {
        throw new Error(`field '${key}': must be <= ${spec.max} (got ${value})`);
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new Error(`field '${key}': expected a boolean`);
      }
      return value;
    }
    case "string": {
      if (typeof value !== "string") {
        throw new Error(`field '${key}': expected a string`);
      }
      return value;
    }
    case "color": {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`field '${key}': expected a non-empty color string`);
      }
      // Hex strings must be well-formed; any other non-empty string (a CSS
      // color name) is accepted leniently.
      if (value.startsWith("#") && !HEX_RE.test(value)) {
        throw new Error(`field '${key}': invalid hex color '${value}'`);
      }
      return value;
    }
    case "enum": {
      const values = spec.values;
      if (!values || values.length === 0) {
        throw new Error(`field '${key}': enum has no 'values' declared`);
      }
      if (typeof value !== "string" || !values.includes(value)) {
        throw new Error(`field '${key}': must be one of [${values.join(", ")}] (got ${JSON.stringify(value)})`);
      }
      return value;
    }
    default: {
      throw new Error(`field '${key}': unknown field type '${(spec as FieldSpec).type}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Schema factory.
// ---------------------------------------------------------------------------
/**
 * Define a runtime schema from a spec.
 *
 * @example
 *   const S = defineSchema({
 *     title: { type: "string", default: "Hello" },
 *     count: { type: "number", min: 0, max: 100, default: 1 },
 *     mode:  { type: "enum", values: ["fast", "slow"], default: "fast" },
 *   });
 *   S.parse({ count: 3 }); // => { title: "Hello", count: 3, mode: "fast" }
 */
export function defineSchema<T = Record<string, any>>(spec: SchemaSpec): Schema<T> {
  if (!spec || typeof spec !== "object") {
    throw new Error("defineSchema: expected a schema spec object");
  }

  const parse = (input: Record<string, any>): T => {
    const src: Record<string, any> = input ?? {};
    if (typeof src !== "object") {
      throw new Error("schema.parse: expected an input object");
    }

    // Reject unknown keys.
    for (const key of Object.keys(src)) {
      if (!(key in spec)) {
        throw new Error(`unknown key '${key}' (not declared in schema)`);
      }
    }

    const out: Record<string, any> = {};
    for (const [key, fieldSpec] of Object.entries(spec)) {
      let value = src[key];

      // Apply default when the value is missing (undefined).
      if (value === undefined && fieldSpec.default !== undefined) {
        value = fieldSpec.default;
      }

      // Still missing?
      if (value === undefined) {
        if (fieldSpec.optional) continue;
        throw new Error(`field '${key}': required`);
      }

      out[key] = validateField(key, fieldSpec, value);
    }

    return out as T;
  };

  const safeParse = (
    input: Record<string, any>,
  ): { ok: true; value: T } | { ok: false; error: string } => {
    try {
      return { ok: true, value: parse(input) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  return { spec, parse, safeParse };
}
