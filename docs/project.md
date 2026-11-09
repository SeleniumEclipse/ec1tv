# Project Structure And Data Flow

Use this page to find the app code, build tools, tests, and assets.

## Files

| Location | Purpose |
| --- | --- |
| [package.json](../package.json) and [package-lock.json](../package-lock.json) | Build, test, and guided-setup commands with locked dependencies. `private: true` prevents accidental npm publication; it does not set GitHub visibility. |
| [.npmrc](../.npmrc) | Public npm registry, TLS checks on, dependency install scripts off. |
| [.gitignore](../.gitignore) | Excludes generated outputs and common private-state/key paths. It does not erase committed data. |
| [appinfo.json](../webos-app/app/appinfo.json) | TV app ID, version, title, Home category, and launch metadata. |
| [index.html](../webos-app/app/index.html) | App entry point and local content-security policy. |
| [main.js](../webos-app/app/main.js) | Navigation, tile editing, preferences, photos, and foreground behavior. |
| [webos.js](../webos-app/app/webos.js) | Validated native inventory, confined artwork/photo reads, and launch requests. |
| [fixtures.js](../webos-app/app/fixtures.js) | Labelled desktop-only example destinations. |
| [home.css](../webos-app/app/home.css) | A 1920-by-1080 scene scaled to fit the viewport, layout, and motion. |
| [assets](../webos-app/app/assets/) | Bundled sample images, font, interface icons, and notices. |
| [webos.test.cjs](../webos-app/tests/webos.test.cjs) | Launcher tests that use simulated TV services. |
| [build.test.cjs](../webos-app/tests/build.test.cjs) | Offline package-tampering, omission, metadata, hook, and path guards. |
| [build.cjs](../webos-app/tools/build.cjs) | Local CLI packaging and source/payload verification. Does not install or launch. |
| [setup.cjs](../tools/setup.cjs) | Interactive Home and OneDrive setup menu. |
| [setup modules](../tools/setup/) | Verified-host SSH, private settings, root-owned recovery, Microsoft device-code login, and photo access. |
| [LICENSE](../LICENSE) | MIT terms for project code and documentation. |

## Data Flow

```text
Remote or pointer -> launcher UI -> structured native launch/settings/input request

Native app list and permitted image files -> existing Homebrew service
    -> validated metadata and bounded image cache -> launcher tiles

Launcher preferences <-> app-local browser storage on that TV

Bundled public-domain images -> local photo display

Your Microsoft sign-in -> memory-only computer authentication
    -> verified SSH connection -> root-private TV photo credentials
    -> on-demand TV helper -> your OneDrive app folder -> launcher photo display
```

App IDs and launch parameters are passed as structured data, not shell text. The
Homebrew service is used for fixed inventory and confined raster reads, not a
user-supplied command box. The service itself still has privileged access; these
client checks do not certify every aspect of a rooted TV's security.

Artwork stays within approved same-app paths with file-type, symlink, identity,
size, and cache checks. Two additional native system-app directories are exact
allowlist entries, not general access to mounted filesystems. Missing/refused
artwork uses a labelled fallback rather than expanding access.

Default native-hidden entries, nondefault duplicates, helpers, and Home launchers
are filtered. Eligible apps and disconnected HDMI inputs can remain available.
Local row hiding does not remove them from All Apps.

## Settings And Build Output

The app saves preferences on the TV under `focusstage.preferences.v1`. This
includes the selected app, row order, hidden tiles, motion, and photo settings.
Hiding a tile changes the row only; it does not uninstall the application.

`npm run package` reads the app folder and writes the IPK under `webos-app/dist`.
Its report is under `webos-app/reports`, and its temporary CLI files are under
`webos-app/.build-work`. Keep private information out of those folders and do not
use them to store source files.

`npm run setup` stores private computer settings outside the repository. Its
fixed TV runtime lives under `/var/lib/ec1tv-setup/runtime`; Home recovery is
kept alongside it. The photo helper lives under `/var/lib/focus-stage-photos` and
runs on demand. No PC server needs to stay running for the launcher or slideshow.

See [photos](photos.md) to change background images and [installation checks](verification.md)
to test your build.

Return to the [overview](../README.md).