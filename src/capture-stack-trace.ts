/**
 * `Error.captureStackTrace` is a V8 extension rather than part of the language.
 * Its type declaration ships with runtime-specific ambient types (`@types/node`,
 * `bun-types`), so relying on the global here would tie this package's compiled
 * output to one runtime's types. Declaring the shape locally keeps `src/` free of
 * that dependency, and the feature check keeps the calls safe on engines such as
 * SpiderMonkey and JavaScriptCore that omit the API — there the stack that
 * `Error` already produced is used as is.
 */

/** A function or class whose frame, and every frame above it, is dropped from the stack. */
type StackFrameLimit =
  | ((...args: never[]) => unknown)
  | (abstract new (...args: never[]) => unknown);

interface StackTraceCapturer {
  captureStackTrace(error: object, stackFrameLimit?: StackFrameLimit): void;
}

function supportsCapture(ctor: ErrorConstructor): ctor is ErrorConstructor & StackTraceCapturer {
  return typeof (ctor as Partial<StackTraceCapturer>).captureStackTrace === "function";
}

/** Trim `error.stack` down to the frames below `stackFrameLimit`, where the engine allows it. */
export function captureStackTrace(error: object, stackFrameLimit?: StackFrameLimit): void {
  if (supportsCapture(Error)) {
    Error.captureStackTrace(error, stackFrameLimit);
  }
}
