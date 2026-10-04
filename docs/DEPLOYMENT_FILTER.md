# Git deployment filtering

Dependabot branch pushes are disabled through `git.deploymentEnabled`. Their
changes deploy when a reviewed PR merges into main. Ordinary product branches
retain preview deployments.

The ignore command compares the previous successful deployment revision with
the current commit. It skips a build only when every changed path is excluded
by the checked-in `.vercelignore`. Site/API changes, package locks, deployment
configuration and the filtering script itself continue to build. Missing or
shallow history, unknown exclusion syntax and Git errors continue to build.
It does not fetch history or use `HEAD^` as an unsafe fallback.

The command reads its script from Git so it works before installation and when
excluded development files are absent from the deployed file tree. Vercel uses
exit 0 to skip a build and exit 1 to proceed. Tests exercise those exact exits.

This reduces unnecessary build work; it does not increase an account allowance
or prove that skipped builds are omitted from deployment-creation limits.
Commercial-plan selection remains an account-owner decision.

References: [Git branch deployment rules](https://vercel.com/docs/project-configuration/git-configuration),
[ignored build step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel).
