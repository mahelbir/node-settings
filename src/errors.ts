import type {StandardSchemaV1} from "@standard-schema/spec";

export class SettingsValidationError extends Error {

    readonly issues: readonly StandardSchemaV1.Issue[];

    constructor(issues: readonly StandardSchemaV1.Issue[]) {
        super(`Settings do not match the schema: ${issues.map(formatIssue).join("; ")}`);
        this.name = "SettingsValidationError";
        this.issues = issues;
    }

}

function formatIssue(issue: StandardSchemaV1.Issue): string {
    const path = issue.path?.map((segment) => String(typeof segment === "object" ? segment.key : segment)).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
}
