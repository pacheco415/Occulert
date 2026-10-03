# Owned font delivery

Marketing pages serve Inter from the pinned `@fontsource-variable/inter` 5.3.0 distribution. The distribution identifies Google Fonts Inter v20 as its source. The seven normal-weight subsets and their upstream SIL Open Font License are copied unchanged into `vendor/inter-5.3.0/`; `upstream.json` records the package integrity and file SHA-256 hashes. The CSS uses the existing `Inter` family name, weights 100–900 and `font-display: swap`.

The Latin subset is 48,256 bytes; browsers request other subsets only for matching characters. The service worker preloads the shared CSS and caches owned font subsets when requested under its control. Font files load on demand to preserve the existing install-size budget. Successful caching is required for offline availability. The homepage keeps its existing nonblocking stylesheet activation and system-font fallback; delayed or failed font styles cannot prevent navigation. Marketing pages no longer request Google font hosts, and their current CSP no longer grants those hosts.

For an update, pin a new distribution directory, preserve upstream notices and add fresh provenance hashes. Publish a new version of `inter-fonts.css` under the release guide. Never replace the bytes at an already published font URL. Run the site verification, actual font-rendering cases and delayed/failed stylesheet cases before release. This change does not claim a real-device performance improvement.

References: [Fontsource self-hosting documentation](https://fontsource.org/docs/getting-started/introduction), [Google Fonts Inter license](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt).
