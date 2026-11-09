# Build, Install, And Use

Install and check the launcher before changing your Home settings. Keep LG Home
available so you can return to it at any time.

## Prerequisites

- A rooted LG webOS TV with working standard Homebrew Channel. Follow
  [compatibility and rooting](rooting.md) first if your TV is not rooted.
- A Windows computer with a supported Node.js release, version 20 or later, and
  npm. The commands in this guide use PowerShell.
- Your own device connection, client key, verified TV host key, and private storage.
  See [security](security.md). Never import someone else's pairing or SSH records.
- A time when nobody else is using the TV.

## Preview And Build

Open [the app entry point](../webos-app/app/index.html) in a desktop browser for a
local preview. It uses example apps and inputs; it does not connect to your TV.

You can download a ready-built IPK from the
[release page](https://github.com/SeleniumEclipse/ec1tv/releases/tag/v0.1.16).
Run `npm ci --ignore-scripts` in the source folder for the guided setup tools.
You only need `npm run package` if you want to build the TV app yourself.

From the repository directory:

```powershell
npm ci --ignore-scripts
npm test
npm run package
```

The build uses LG CLI 3.2.6. Use `npm ci` to install the versions listed in the
lockfile. Keep certificate checks enabled and dependency install scripts disabled.
The builder creates the package and compares its contents with the source files.
It does not install anything on your TV.

Outputs:

```text
webos-app/dist/io.focusstage.home_0.1.16_all.ipk
webos-app/reports/io.focusstage.home_0.1.16_build.json
webos-app/.build-work/package-*/
```

These directories are ignored by Git. Raw build logs can contain local paths.
Keep a known-good package and its report before building an update. The builder
refuses to overwrite them. Move your existing package and matching report to a
private backup folder before rebuilding the same version. Use the build folders
only for generated files.

**Checkpoint:** tests pass; the build succeeds; the output version and SHA-256
checksum match the package you intend to install. A checksum identifies bytes,
not whether those bytes are trustworthy.

## Pair Your Own TV

Use the maintained [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop)
or LG CLI with the rooted-TV connection appropriate to your setup. A rooted TV's
SSH connection and an unrooted Developer Mode connection are different. Do not
install LG Developer Mode onto a rooted TV merely to obtain a pairing key.

For CLI use, the local tool opens its interactive setup with:

```powershell
npx --no-install ares-setup-device
```

Create a distinct alias for your TV. Supply your own address, supported SSH user,
port, and client identity. Enter any sensitive prompt directly into the terminal;
do not place passphrases in command lines, screenshots, source, or issues. Confirm
the TV's host identity independently and keep strict host checking enabled.

If you cannot establish a trusted connection and a recovery path, stop. Do not
weaken verification, use a shared key, or expose TV ports through the router.

## Install Without Changing Home

This step changes the TV. Confirm the TV alias, package, and current installation
first. Do not replace an existing `io.focusstage.home` installation without
reviewing its version/settings and preserving its known-good package.

Select your TV in Dev Manager and install the IPK through its app-install screen.
For CLI installation, use:

```powershell
npx --no-install ares-install --device YOUR_TV_ALIAS webos-app/dist/io.focusstage.home_0.1.16_all.ipk
```

Replace `YOUR_TV_ALIAS` with the alias you created. Check it before running the
command; installation changes that TV.

Open Focus Stage manually from LG Home after installation. An install success
reply is not proof of actual display, usable input, sound, or Home routing.

**Checkpoint:** test the actual app list, a fully started app, an HDMI input,
volume/audio, Menu > TV settings, and Menu > Original LG Home. Keep LG Home as
the default if any check fails. Then read [default Home setup](home.md).

## Run Guided Setup

Open an interactive terminal in the project directory and run:

```powershell
npm run setup
```

Choose **Check connection and status** first. Enter your TV's local IP address,
root SSH port, private-key file path, and independently verified host fingerprint.
Enter an encrypted key's passphrase directly into the hidden terminal prompt.
Do not paste passwords, keys, or sign-in codes into chat or a support issue.

Connection settings are stored privately under `%LOCALAPPDATA%/ec1tv` on Windows.
Key contents, passphrases, and Microsoft tokens are not saved there. The setup
asks before installing its root-private TV helper or changing Home/photo settings.

Choose each feature separately. **Use ec1tv as Home** and **Restore LG Home** are
described in the [Home guide](home.md). **Connect OneDrive photos**, **Check OneDrive
photos**, and **Disconnect OneDrive photos** are described in [photos](photos.md).

The helper uses this TV's own recovery records. If it finds an existing setup it
does not manage, it stops rather than replacing it. Keep the matching project
version and private recovery folder available until you have checked restoration.

## Everyday Controls

| Action | Result |
| --- | --- |
| Left/right on the remote | Moves through the app/input row. |
| Short OK press | Launches on release. |
| Hold OK for about 650 ms | Opens tile controls instead of launching. |
| Left/right in a row tile's edit controls | Reorders that tile locally. |
| Hide in those controls | Removes it from the row, not from the TV. |
| Down from the row | Opens All Apps and inputs. |
| Hold a tile in All Apps | Shows/hides it in the row, without hidden reorder controls. |
| Up from the first All Apps row, or Back | Closes All Apps. |
| Up from the launcher row | Reaches Photos and Menu. |
| Pointer hover | Selects visible tiles without moving their centers. |
| Far row edges or remote wheel | Scrolls the row. |

Menu provides native settings, Original LG Home, refresh, and reduced motion.
Photo auto-hide is on by default: controls move away after about one minute of
inactivity, and the first navigation/OK/click wakes them without launching. Photos
can disable auto-hide. It is not the TV's system-level idle-app setting.

Preferences stay in app-local browser storage under `focusstage.preferences.v1`.
Hiding an app is not uninstalling it. Clearing/removing the launcher may lose its
preferences but does not remove other apps. The launcher is not an app store.

The first launch after power-on can take longer than a later Home return. Wait
for an app to finish starting before pressing Home, so it does not retake input
while you are using the launcher.

Return to the [overview](../README.md).