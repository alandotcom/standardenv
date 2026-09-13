// biome-ignore-all lint/suspicious/noExplicitAny: ___

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { captureStackTrace } from "./capture-stack-trace.js";
import { AsyncValidationError, EnvValidationError } from "./errors.js";

/**
 * A single configuration property.  The type of `default` is the
 * inferred output of the schema you provide via `format`.
 */
export interface ConfigProperty<TSchema extends StandardSchemaV1> {
  format: TSchema;
  default?: StandardSchemaV1.InferOutput<TSchema>;
  env: string;
  optional?: boolean;
}

/**
 * The base shape of a configuration definition: each key can be a
 * nested object or a (loosely typed) `ConfigProperty`.
 */
export type ConfigDefinition = {
  [key: string]: ConfigDefinition | ConfigProperty<StandardSchemaV1>;
};

/**
 * Rebuilds a config literal so that each leaf with a `format` and `env`
 * becomes a strongly typed `ConfigProperty<S>`, where `S` is the type
 * of the `format` field.
 */
type ConfigFrom<T> = {
  [K in keyof T]: T[K] extends {
    format: infer S extends StandardSchemaV1;
    env: string;
  }
    ? ConfigProperty<S>
    : T[K] extends object
      ? ConfigFrom<T[K]>
      : never;
};

/**
 * Infer the output type from a config definition.  Required properties
 * are kept, optional properties become optional in the result.  Note
 * the use of `ConfigProperty<any>` to satisfy TypeScript’s requirement
 * that a type argument be provided.
 */
export type InferConfig<T extends ConfigDefinition> = {
  [
    K in keyof T as IsConfigProperty<T[K]> extends true
      ? IsOptionalWithoutDefault<T[K]> extends true
        ? never
        : K
      : K
  ]: IsConfigProperty<T[K]> extends true
    ? PropertyOutput<T[K]>
    : T[K] extends ConfigDefinition
      ? InferConfig<T[K]>
      : never;
} & {
  [
    K in keyof T as IsConfigProperty<T[K]> extends true
      ? IsOptionalWithoutDefault<T[K]> extends true
        ? K
        : never
      : never
  ]?: PropertyOutput<T[K]> | undefined;
};

type PropertyOutput<P> = P extends { format: infer S }
  ? S extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<S>
    : unknown
  : never;

type IsConfigProperty<P> = P extends {
  format: StandardSchemaV1;
  env: string;
}
  ? true
  : false;

type HasOptional<P> = P extends { optional: infer O } ? (true extends O ? true : false) : false;

type HasDefault<P> = P extends { default: infer _ } ? true : false;

type IsOptionalWithoutDefault<P> =
  HasOptional<P> extends true ? (HasDefault<P> extends true ? false : true) : false;

/**
 * Check if an object is a config property (has format, env, and optionally default).
 */
function isConfigProperty(value: unknown): value is ConfigProperty<StandardSchemaV1> {
  return (
    typeof value === "object" &&
    value !== null &&
    "format" in value &&
    "env" in value &&
    typeof (value as Record<string, unknown>).env === "string"
  );
}

/**
 * Any non-null object reached during traversal that is not itself a property
 * definition, and so is treated as a nested group of properties.
 */
function isNestedConfig(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read a validator's Standard Schema properties, or `undefined` when the
 * validator does not implement the interface.
 *
 * `ConfigProperty` declares `format` as a `StandardSchemaV1`, but the value is
 * supplied by calling code and arrives here unchecked. Reading `~standard`
 * through an optional type keeps a non-compliant validator on the path that
 * reports it as an issue, instead of throwing on a missing property.
 */
function standardSchemaProps(format: StandardSchemaV1): StandardSchemaV1.Props | undefined {
  return (format as Partial<StandardSchemaV1> | undefined)?.["~standard"];
}

/**
 * Parse environment variables using a declarative configuration structure.
 *
 * The second argument must satisfy the shape given by `ConfigFrom<T>`.  This
 * ensures that each `default` value is assignable to the output type of its
 * schema; if it isn’t, TypeScript will produce a compile‑time error.
 */
export function envParse<T extends ConfigDefinition>(
  env: Record<string, string | undefined>,
  config: T & ConfigFrom<T>,
): InferConfig<T> {
  const result: Record<string, unknown> = {};
  const issues: StandardSchemaV1.Issue[] = [];
  const vendors = new Set<string>();

  function validateProperty(
    property: ConfigProperty<StandardSchemaV1>,
    envVars: Record<string, string | undefined>,
  ): { issues: StandardSchemaV1.Issue[]; value?: unknown } {
    const propertyIssues: StandardSchemaV1.Issue[] = [];
    const envValue = envVars[property.env];
    const standardProps = standardSchemaProps(property.format);
    if (standardProps && typeof standardProps.vendor === "string") {
      vendors.add(standardProps.vendor);
    }

    // If env var is not set, use default (which is already the correct output type)
    if (envValue === undefined) {
      if (property.default !== undefined) {
        return { issues: propertyIssues, value: property.default };
      }

      if (property.optional) {
        return { issues: propertyIssues };
      }

      propertyIssues.push({
        message: `Required environment variable ${property.env} is not set and no default provided`,
        path: [property.env],
      });

      return { issues: propertyIssues };
    }

    // If env var is set, validate it (it's always a string from environment)
    const validationResult = standardProps?.validate(envValue);
    if (!validationResult) {
      propertyIssues.push({
        message: `Validator for ${property.env} is not Standard Schema compliant`,
        path: [property.env],
      });
      return { issues: propertyIssues };
    }

    if (validationResult instanceof Promise) {
      const error = new AsyncValidationError();
      captureStackTrace(error, envParse);
      throw error;
    }

    if (validationResult.issues) {
      propertyIssues.push(
        ...validationResult.issues.map((issue) => ({
          ...issue,
          path: issue.path ? [property.env, ...issue.path] : [property.env],
          message: `${property.env}: ${issue.message}`,
        })),
      );

      return { issues: propertyIssues };
    }

    return { issues: propertyIssues, value: validationResult.value };
  }

  function handleConfigProperty(
    key: string,
    property: ConfigProperty<StandardSchemaV1>,
    envVars: Record<string, string | undefined>,
    target: Record<string, unknown>,
  ): void {
    const { issues: propertyIssues, value: validatedValue } = validateProperty(property, envVars);

    if (propertyIssues.length > 0) {
      issues.push(...propertyIssues);
      return;
    }

    if (validatedValue !== undefined || !property.optional) {
      target[key] = validatedValue;
    }
  }

  function processConfig(
    configObj: Record<string, unknown>,
    envVars: Record<string, string | undefined>,
    target: Record<string, unknown>,
  ): void {
    for (const [key, value] of Object.entries(configObj)) {
      if (isConfigProperty(value)) {
        handleConfigProperty(key, value, envVars, target);
      } else if (isNestedConfig(value)) {
        const nested: Record<string, unknown> = {};
        target[key] = nested;
        processConfig(value, envVars, nested);
      }
    }
  }

  processConfig(config, env, result);

  if (issues.length > 0) {
    const vendorLabel =
      vendors.size === 0
        ? "unknown"
        : vendors.size === 1
          ? vendors.values().next().value!
          : `mixed(${Array.from(vendors).join(",")})`;
    const error = new EnvValidationError(issues, vendorLabel);
    captureStackTrace(error, envParse);
    throw error;
  }

  // `result` is built key by key at runtime, so its shape is only known to match
  // `InferConfig<T>` by construction. This is the one assertion the design needs.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return result as InferConfig<T>;
}
