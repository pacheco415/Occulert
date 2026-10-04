# Sitemap maintenance

Run `npm run sitemap:update` in a complete Git checkout after relevant page/asset changes are committed. The generator removes duplicate fragment variants and derives each page date from its latest tracked HTML or directly referenced first-party JS/CSS change. It refuses shallow history instead of attributing one CI checkout date to every page.

`npm run audit:sitemap` checks a nonempty set of canonical unique URLs without credentials, page existence and valid nonfuture dates. It works in shallow CI and does not claim that a source date confirms deployment. Keep authenticated app/account indexing decisions separate from authentication: sitemap and robots directives never protect private data.
