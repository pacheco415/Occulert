# Security reporting

Report suspected product vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/pacheco415/Occulert/security/advisories/new). Include the affected component and source commit or app build, reproduction steps using synthetic accounts, expected behavior, and the observed security impact. Do not open a public issue containing exploit details before coordinated review.

Never include access tokens, service-role keys, passwords, driver identity, exact location, personal media, raw motion, or customer records. Redact logs and use synthetic data. If a credential has escaped, revoke or rotate it using its provider; removing it from a current file does not revoke it.

The maintained source is `main`; published website assets are immutable and old cached versions may remain available during rollout. Native builds may lag source fixes: include the installed version and build number. This project has no guaranteed support window or response deadline.

Occulert-AI is a separate local research prototype. A passing source test does not establish detection accuracy or physical-device acceptance. Avoid testing against another person's account or production fleet data.

See [RELEASING.md](RELEASING.md) for release verification and [BACKEND_SETUP.md](BACKEND_SETUP.md) for server-only credentials and database setup.
