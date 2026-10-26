// Faceless Studio: a tiny shape checker standing in for zod (no npm installs allowed).
// Covers only what the ported AttentionOS guardrails need: object/strictObject, string min/max, enum, array min/default,
// optional, nullable, default, boolean, number. safeParse returns { success, data } or { success: false, error: { issues } }.

export type SchemaIssue = { path: (string | number)[]; message: string };
type Result<T> = { success: true; data: T } | { success: false; error: { issues: SchemaIssue[] } };

export class Schema<T = unknown> {
  isOptional = false;
  hasDefault = false;
  defaultValue: unknown = undefined;
  isNullable = false;

  check(_value: unknown, _path: (string | number)[], _issues: SchemaIssue[]): T { throw new Error("Schema.check must be overridden"); }

  run(value: unknown, path: (string | number)[], issues: SchemaIssue[]): T | undefined | null {
    if (value === undefined) {
      if (this.hasDefault) return structuredClone(this.defaultValue) as T;
      if (this.isOptional) return undefined;
      issues.push({ path, message: "is required" });
      return undefined;
    }
    if (value === null) {
      if (this.isNullable) return null;
      issues.push({ path, message: "must not be null" });
      return undefined;
    }
    return this.check(value, path, issues);
  }

  safeParse(value: unknown): Result<T> {
    const issues: SchemaIssue[] = [];
    const data = this.run(value, [], issues);
    return issues.length ? { success: false, error: { issues } } : { success: true, data: data as T };
  }

  private clone(patch: Partial<Schema<T>>): this {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, patch);
  }
  optional(): this { return this.clone({ isOptional: true }); }
  nullable(): this { return this.clone({ isNullable: true }); }
  default(v: unknown): this { return this.clone({ hasDefault: true, defaultValue: v }); }
}

class StringSchema extends Schema<string> {
  minLen = 0;
  maxLen = Infinity;
  min(n: number): this { return Object.assign(Object.create(StringSchema.prototype), this, { minLen: n }); }
  max(n: number): this { return Object.assign(Object.create(StringSchema.prototype), this, { maxLen: n }); }
  check(v: unknown, path: (string | number)[], issues: SchemaIssue[]): string {
    if (typeof v !== "string") { issues.push({ path, message: "must be a string" }); return ""; }
    if (v.length < this.minLen) issues.push({ path, message: this.minLen === 1 ? "must not be empty" : `must be at least ${this.minLen} characters` });
    if (v.length > this.maxLen) issues.push({ path, message: `must be at most ${this.maxLen} characters` });
    return v;
  }
}

class NumberSchema extends Schema<number> {
  check(v: unknown, path: (string | number)[], issues: SchemaIssue[]): number {
    if (typeof v !== "number" || !Number.isFinite(v)) issues.push({ path, message: "must be a number" });
    return v as number;
  }
}

class BooleanSchema extends Schema<boolean> {
  check(v: unknown, path: (string | number)[], issues: SchemaIssue[]): boolean {
    if (typeof v !== "boolean") issues.push({ path, message: "must be true or false" });
    return v as boolean;
  }
}

class EnumSchema<T extends string> extends Schema<T> {
  values: readonly T[];
  constructor(values: readonly T[]) { super(); this.values = values; }
  check(v: unknown, path: (string | number)[], issues: SchemaIssue[]): T {
    if (!this.values.includes(v as T)) issues.push({ path, message: `must be one of ${this.values.join(", ")}` });
    return v as T;
  }
}

class ArraySchema<T> extends Schema<T[]> {
  minLen = 0;
  item: Schema<T>;
  constructor(item: Schema<T>) { super(); this.item = item; }
  min(n: number): this { return Object.assign(Object.create(ArraySchema.prototype), this, { minLen: n }); }
  check(v: unknown, path: (string | number)[], issues: SchemaIssue[]): T[] {
    if (!Array.isArray(v)) { issues.push({ path, message: "must be a list" }); return []; }
    if (v.length < this.minLen) issues.push({ path, message: `must have at least ${this.minLen} item${this.minLen === 1 ? "" : "s"}` });
    return v.map((x, i) => this.item.run(x, [...path, i], issues) as T);
  }
}

class ObjectSchema extends Schema<Record<string, unknown>> {
  shape: Record<string, Schema<unknown>>;
  strict: boolean;
  constructor(shape: Record<string, Schema<unknown>>, strict: boolean) { super(); this.shape = shape; this.strict = strict; }
  check(v: unknown, path: (string | number)[], issues: SchemaIssue[]): Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) { issues.push({ path, message: "must be an object" }); return {}; }
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(this.shape)) {
      const r = s.run(src[k], [...path, k], issues);
      if (r !== undefined) out[k] = r;
    }
    if (this.strict) for (const k of Object.keys(src)) if (!(k in this.shape)) issues.push({ path: [...path, k], message: "is not an allowed key" });
    return out;
  }
}

export const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  enum: <T extends string>(values: readonly T[]) => new EnumSchema<T>(values),
  array: <T>(item: Schema<T>) => new ArraySchema<T>(item),
  object: (shape: Record<string, Schema<any>>) => new ObjectSchema(shape, false),
  strictObject: (shape: Record<string, Schema<any>>) => new ObjectSchema(shape, true),
};
