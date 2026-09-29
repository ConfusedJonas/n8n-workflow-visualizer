# Security policy

## Supported version

Security fixes target the latest revision of the `main` branch.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when it is available. If that option is unavailable, open a minimal issue asking the maintainer for a private contact channel. Do not include credentials, private workflow exports, exploit payloads, or other sensitive details in a public issue.

The application is intentionally browser-only. Imported workflow data stays in the browser's IndexedDB storage, and workflow URL or file references are displayed but never fetched or opened automatically. Please report any behavior that causes imported content to execute, make network requests, escape sanitization, or appear in committed fixtures or telemetry.
