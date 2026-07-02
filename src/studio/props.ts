// Schema → editor controls: turn a defineSchema() spec (see core/schema.ts) into
// UI control descriptors a props panel can render. This is the data half of the
// Studio's schema-driven props editor (framework-agnostic; render however you like).

export interface PropControl {
  name: string;
  control: "text" | "number" | "checkbox" | "color" | "select";
  label: string;
  default?: any;
  min?: number;
  max?: number;
  options?: string[];
  description?: string;
}

const CONTROL_FOR: Record<string, PropControl["control"]> = {
  string: "text", number: "number", boolean: "checkbox", color: "color", enum: "select",
};

/** Convert a schema (or its `.spec`) into an ordered list of control descriptors. */
export function schemaToControls(schema: any): PropControl[] {
  const spec = schema?.spec ?? schema ?? {};
  return Object.keys(spec).map((name) => {
    const f = spec[name] ?? {};
    return {
      name,
      control: CONTROL_FOR[f.type] ?? "text",
      label: name,
      default: f.default,
      min: f.min,
      max: f.max,
      options: f.values,
      description: f.description,
    };
  });
}
