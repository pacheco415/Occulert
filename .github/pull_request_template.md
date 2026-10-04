## Problem and resulting behavior
Describe the concrete trigger and what changes for the user.

## Validation
Record the source commit, environment, checks and pass/fail results. For site changes use Node 24 and `npm ci && npm run verify`; for native changes also run `npm ci --include=dev && npm run verify` in native-app. Include relevant browser/device evidence and clearly distinguish synthetic checks from physical acceptance.

## Release and data considerations
List migrations and deployment order, changed published assets, consent/account boundaries and any remaining limits. Follow RELEASING.md. Explain why a field is unknown rather than substituting a reassuring value.

Keep evidence free of tokens, personal media, raw motion, exact location and customer identity. Never use CI skip tokens.
