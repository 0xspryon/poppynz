# Server scripts

Every script here runs on the WordPress site through the Novamira MCP ability `novamira/execute-php`.
Paste the file content as the `code` parameter **without its first `<?php` line**.

Order for a fresh site:

1. Build: `cd apps/landing-page/builder && bun run build` (writes `json-artefacts/current`).
2. Zip the artefact together with `server/` and `theme/`:
   `bash .claude/skills/elementor-v4-port/scripts/pack.sh current` -> `<scratchpad>/poppynz-artefact.zip`
3. Upload link: ability `novamira/create-upload-link` with `{"path":"wp-content/novamira-sandbox/poppynz-artefact.zip","overwrite":true}`.
4. `bash .claude/skills/elementor-v4-port/scripts/push.sh <zip> <token> https://staging.poppynz.com`
5. Unzip on the server (execute-php): see `unpack.php`.
6. `bootstrap.php` once per site, then `import.php` for every deploy. `snapshot.php` before importing on production.
7. `verify.php` after every import.

`restore.php` restores snapshotted posts, kit meta and options. Posts created after the snapshot are
reported under `'unexpected'` and must be removed by hand.

On a bare site, run `bootstrap.php` twice: the first run installs and activates the plugins, the second configures Elementor and Polylang (their singletons only load on the next request).
