# ec1tv

A home screen for LG webOS TVs. Browse apps and HDMI inputs, arrange your app row,
and display photos when the controls are idle.

## Download

Download the [source ZIP](https://github.com/SeleniumEclipse/ec1tv/archive/refs/heads/main.zip)
and extract it. Open a terminal in the extracted project folder to run the setup
commands below.

For a ready-built TV app, download the IPK and its checksum from
[ec1tv 0.1.16](https://github.com/SeleniumEclipse/ec1tv/releases/tag/v0.1.16).
The IPK is a TV app package, not a Windows installer. Keep the source folder for
the guided Home and OneDrive setup tools.

## What You Need

- A compatible rooted LG webOS TV with standard Homebrew Channel.
- A computer with a supported Node.js release, version 20 or later, and npm.
- Your own TV connection and a private folder for keys and recovery information.

Check [compatibility and rooting](docs/rooting.md) before changing your TV.
Rooting support depends on its exact model and firmware.

## Set Up Your TV

1. [Check compatibility and set up root access](docs/rooting.md).
2. [Build and install the launcher](docs/setup.md).
3. Run `npm run setup` and [configure the Home button](docs/home.md).
4. Optionally [connect your own OneDrive photo folder](docs/photos.md).
5. [Check your installation](docs/verification.md).

The app appears as **Focus Stage** on the TV. Its application ID is
`io.focusstage.home`.

## Build The App

Run these commands from the project directory:

```powershell
npm ci --ignore-scripts
npm test
npm run package
```

These commands install build tools, run tests, and create an IPK, the file you
install on your TV. They do not connect to the TV.

Your package is written to `webos-app/dist/io.focusstage.home_0.1.16_all.ipk`.
The builder stops if that package already exists. Keep a known-good package before
replacing it with an update.

To try the controls on your computer, open [the app](webos-app/app/index.html)
in a browser. The desktop preview uses example apps and inputs. It needs no server.

## Compatibility

| TV | Firmware | webOS SDK | Homebrew Channel |
| --- | --- | --- | --- |
| LG 86UR8000AUA | 33.31.75 | 10.3.2 | 0.7.3 |

This is the tested configuration. Treat other combinations as unverified and
check their current rooting support. Developer Mode alone does not provide the
root access required by the launcher and native Home settings.

## More Help

- [Updates, removal, and troubleshooting](docs/recovery.md)
- [Protect your keys and accounts](docs/security.md)
- [Project files and how they work](docs/project.md)
- [Licences and asset credits](THIRD-PARTY-NOTICES.md)

## Licence

Project code and documentation use the [MIT licence](LICENSE). Keep the separate
font, icon, and image notices listed in [asset credits](THIRD-PARTY-NOTICES.md).