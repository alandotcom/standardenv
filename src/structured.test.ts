import { describe, expect, it } from "vitest";
import { EnvValidationError } from "./errors.js";
import { envParse } from "./structured.js";

/** A validator with no `~standard` property, which `envParse` must report rather than throw on. */
const parseWithNonCompliantValidator = () =>
  envParse(
    { PORT: "3000" },
    // @ts-expect-error a validator with no "~standard" property is the case under test
    { port: { format: {}, env: "PORT" } },
  );

describe("envParse", () => {
  it("reports a validator that does not implement Standard Schema", () => {
    expect(parseWithNonCompliantValidator).toThrow(EnvValidationError);
    expect(parseWithNonCompliantValidator).toThrow(/not Standard Schema compliant/);
  });
});
