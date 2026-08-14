# Security

Growth Acquisition is local-first. It reads files under the configured root and does not upload vault content by default.

- External API access is opt-in and read-only.
- File writes require preview plus explicit confirmation.
- Writes use a version guard to avoid overwriting concurrent edits.
- Paths outside `defaultRoot` are rejected.
- Results avoid echoing raw customer PII where possible.
- Metric failures and missing data are reported rather than treated as zero.

Please report security issues privately to the project owner rather than opening a public issue with sensitive data.
