import { afterEach, describe, expect, it } from "vitest";
import { captureStackTrace } from "./capture-stack-trace.js";
import { EnvValidationError } from "./errors.js";

// Reached through an index signature so the tests can remove `captureStackTrace`
// and put it back. The ambient runtime types declare it as a required property,
// which would otherwise rule out both the removal and the restore.
const errorGlobal = Error as unknown as Record<string, unknown>;
const originalCapture = errorGlobal.captureStackTrace;

/** Run the engines that omit the V8 extension, such as SpiderMonkey and JavaScriptCore. */
function withoutCaptureStackTrace() {
  Reflect.deleteProperty(Error, "captureStackTrace");
}

afterEach(() => {
  errorGlobal.captureStackTrace = originalCapture;
});

/** Raises an error and trims its own frame off the stack, leaving its callers. */
function inner() {
  const error = new Error("boom");
  captureStackTrace(error, inner);
  return error;
}

function outer() {
  return inner();
}

describe("captureStackTrace", () => {
  it("drops the frames above the given function", () => {
    const stack = outer().stack ?? "";
    expect(stack).not.toContain("at inner");
    expect(stack).toContain("at outer");
  });

  it("leaves the stack in place on engines without the V8 extension", () => {
    withoutCaptureStackTrace();

    const error = new Error("boom");
    const stackBefore = error.stack;

    expect(() => captureStackTrace(error)).not.toThrow();
    expect(error.stack).toBe(stackBefore);
  });
});

describe("EnvValidationError", () => {
  it("constructs on engines without the V8 extension", () => {
    withoutCaptureStackTrace();

    const error = new EnvValidationError([{ message: "Required" }], "zod");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Required");
    expect(error.stack).toBeDefined();
  });
});
