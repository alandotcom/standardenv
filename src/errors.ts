import type { StandardSchemaV1 } from "@standard-schema/spec";
import { captureStackTrace } from "./capture-stack-trace.js";

export class EnvValidationError extends Error {
  readonly issues: readonly StandardSchemaV1.Issue[];
  readonly vendor: string;

  constructor(issues: readonly StandardSchemaV1.Issue[], vendor: string) {
    super(EnvValidationError.formatMessage(issues, vendor));
    this.name = "EnvValidationError";
    this.issues = issues;
    this.vendor = vendor;
    captureStackTrace(this, EnvValidationError);
  }

  private static formatMessage(issues: readonly StandardSchemaV1.Issue[], vendor: string): string {
    const header = `Environment validation failed (using ${vendor}):`;
    const formattedIssues = issues
      .map((issue) => {
        const path = issue.path
          ? issue.path
              .map((segment) => (typeof segment === "object" ? segment.key : segment))
              .join(".")
          : "ENV";
        return `  - ${path}: ${issue.message}`;
      })
      .join("\n");

    return `${header}\n${formattedIssues}`;
  }
}

export class AsyncValidationError extends Error {
  constructor() {
    super(
      "Async validation is not supported. Environment variables must be validated synchronously.",
    );
    this.name = "AsyncValidationError";

    captureStackTrace(this, AsyncValidationError);
  }
}
