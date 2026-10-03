# Verification evidence

Core site, browser, native, EAS-install and Watch notification jobs retain a JSON receipt for 14 days. Each receipt records the actual checked-out Git revision, both dependency lockfile hashes, timestamp, Node/npm versions, platform, installed tool versions and GitHub run identity. It records the result of workflow steps before receipt/artifact upload; an upload failure is not retroactively represented as a verification failure or success.

Only selected nonsecret metadata are collected. The script never serializes the environment, credentials, account identifiers, driver records, camera media or sensor data. Missing installed tools are null, not represented as successfully installed. `physical_acceptance:false` remains explicit: a software check cannot establish real phone, Watch, headphone or driving accuracy acceptance.

For locally completed checks, run `node scripts/write-verification-receipt.mjs site success` only after the corresponding command actually passes. The result argument is a caller claim; CI passes its observed job result automatically. Receipts do not replace test output, hosted required checks, source review or physical validation.
