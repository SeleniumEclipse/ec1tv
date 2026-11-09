# Updates And Recovery

Keep a working package and a backup of your TV settings before installing an
update. Restore Home settings before removing an app selected as Home.

## Before Updating

1. Arrange a maintenance window with the TV's users.
2. Verify the intended TV identity and exact installed app version. Stop on a
   changed host key, unknown package, or missing recovery record.
3. Keep the prior reviewed package/checksum and the TV's own settings/file baseline
   in private storage. Do not use another TV's records.
4. Review the new source, compatibility, permissions, and notices. Test and build
   locally, then check the exact new output rather than a stale report.
5. Apply only the approved component update through your own configured device
   connection. Test actual navigation, apps, HDMI, sound, and Home return.

An install timeout does not prove that nothing changed. Inspect actual install
state before retrying or clearing staging. A success reply does not prove the
first screen appeared or that controls and playback work.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Unsupported/patched firmware | Check [rooting compatibility](rooting.md) and stop if your firmware is unsupported. Developer Mode alone does not provide the required root access. |
| Cannot connect | Confirm the address and network/power state with the owner. Do not scan unrelated devices or change router/DNS as a default fix. |
| Host key differs | Establish why through a trusted path. Do not accept every key or overwrite the saved pin silently. |
| Missing inventory | Confirm the supported Homebrew access. The TV must not fall back to desktop fixtures. |
| Missing icon | Use the labelled fallback; check the same-app path/type/size limit rather than broadening filesystem access. |
| Home is slow after power-on | Allow the TV and app to finish starting. Compare the first launch with later Home returns. |
| Home during an unfinished app launch overlaps | Wait for that app to finish starting before pressing Home. |
| Home does not close a launcher menu | Use Back. Native Home routing may not relaunch the already foreground page. |
| OneDrive does not connect | Check your own registration, account, app-folder permission, and installed launcher version. Run **Check OneDrive photos**; disconnect/reconnect if the saved login expired. See [photos](photos.md). |
| Setup reports an uncertain result | Run **Check connection and status** before retrying. Use the matching recovery action; do not repeat an apply operation blindly. |
| Setup finds a different existing Home/photo configuration | Keep its files and use that configuration's own recovery procedure. Do not remove its ownership checks. |
| Existing package blocks a rebuild | Move your existing package and matching build report to a private backup folder before rebuilding. |
| npm reports certificate/network errors | Keep TLS verification on. Check the environment or retry when connectivity is restored; do not adopt an untrusted registry or certificate bypass. |

## Removing A Manually Opened Launcher

First confirm that neither saved Home, effective Home/idle profiles, nor a startup
mechanism selects `io.focusstage.home`. If it was only installed/opened as an app,
use the supported app-removal interface for that developer app during an agreed
window. The CLI command form is:

```powershell
npx --no-install ares-install --device YOUR_TV_ALIAS --remove io.focusstage.home
```

Replace `YOUR_TV_ALIAS` with your own verified alias. The command removes the app
from that TV and can erase its local preferences. It does not uninstall other
apps or unroot the TV.

## Removing A Default Home

Do not run the removal command while the launcher is still selected as Home or
idle. Run `npm run setup`, choose **Restore LG Home**, and follow the
[Home recovery checks](home.md). Verify physical Home and app/input resume before
removing the launcher.

Menu > Original LG Home opens the original interface but is not a persistent
configuration reset. A reboot or factory reset is not a certified substitute
for restoring the exact changed layers.

If the recorded state no longer matches, stop and keep it for troubleshooting.
Do not force overwrites or remove whole system directories. Preserve your backup
until the original Home, inputs, and sound work correctly.

Removing root or Homebrew is a separate operation. Follow the recovery instructions
for your rooting method; removing the launcher does not undo those changes.

## Disconnect Photos

Run `npm run setup` and choose **Disconnect OneDrive photos**. This removes the
saved TV login without deleting cloud pictures. Turn off OneDrive photos in the
TV menu. Revoke the application's access through your own Microsoft account if
you want to end its consent too; this can affect other TVs using that registration.

Keep the setup runtime and recovery records until Home restoration and photo
disconnection are confirmed. If a record or owned file changed unexpectedly,
stop and investigate instead of deleting the folder.

Return to the [overview](../README.md).