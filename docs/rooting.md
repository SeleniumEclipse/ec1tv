# Compatibility And Rooting

Check your exact TV model and firmware before rooting. Firmware updates can
change which methods work.

Rooting grants administrator control of the TV's operating system through a
security vulnerability. It is not the same as installing a normal app or enabling
Developer Mode. Incorrect privileged changes can make the TV unusable; service,
warranty, security, and streaming behavior may be affected.

## Tested Combination

| Item | Tested configuration |
| --- | --- |
| TV | LG 86UR8000AUA |
| Firmware | 33.31.75 |
| webOS SDK | 10.3.2 |
| Homebrew | Standard Homebrew Channel 0.7.3 |
Check other screen sizes, region suffixes, and firmware separately. Do not assume
that a similar model supports the same rooting method.

## Check Before Proceeding

1. Read the exact model suffix and software version from the TV's ordinary
   information/settings screen. Menu locations vary; do not enter a service menu.
2. Keep the firmware version separate from the webOS/SDK version. Do not guess
   compatibility from the purchase year or the product family name.
3. Check [CanI.RootMy.TV](https://cani.rootmy.tv/) for the exact combination.
4. Read the chosen method's current README and patch status. Start with the
   [Homebrew rooting guide](https://www.webosbrew.org/rooting/) and follow its
   link to the method recommended for your TV.
5. Stop if support is unknown or patched. Do not force a downgrade, alter service
   settings, open the TV, weaken TLS, or try a series of unrelated exploits.

Current [SlopBro guidance](https://github.com/throwaway96/slopbro) says it is **not
expected to work on webOS 10 and 11 firmware released since about October 10,
2026**. Check this warning even if your TV belongs to a generally supported
webOS generation. A brand-new or recently updated TV may not be rootable.

The [faultmanager method](https://github.com/throwaway96/faultmanager-autoroot)
also lists patches on most newer webOS 5+ firmware and webOS 10.1+. Follow the
current method-specific compatibility information.

## Prepare Your Own Setup

Use a trusted local network and a private, nonsynced computer folder outside all
repositories for pairing keys, logs, and recovery records. Schedule a maintenance
window: rooting can launch content on the TV and require a restart.

Use the method maintainer's source/release and review its version, available
checksums, licence, and warnings. Do not download random repackaged executables.
Do not expose a payload server, SSH, developer access, or a debugger to the Internet.

Firmware updates can fix security problems and can change or remove root access.
Check compatibility before updating. Do not disable updates, change network
filtering, or flash a different firmware as a routine setup step.

## SlopBro Route For A Compatible TV

Follow this section only if SlopBro currently supports your TV and firmware.

1. Download the compatible release or source revision from the official
   [SlopBro project](https://github.com/throwaway96/slopbro). Keep its assets and
   script versions together. Extract them into your private working folder.
2. Install Python 3.8 or later on your computer, following the tool's current
   requirements.
3. Read the current TV LAN address from its own network settings and identify the
   correct computer LAN address. Do not use another person's address or scan
   unrelated devices.
4. Read the tool's help, then use its documented command form when ready:

```powershell
python slopbro.py --help
python slopbro.py --webos-version YOUR_WEBOS_MAJOR --local-ip YOUR_PC_LAN_ADDRESS YOUR_TV_LAN_ADDRESS
```

Replace every placeholder first. The help is local; the second command launches
a TV page and attempts root installation. Run it only on a device you own or
have explicit permission to administer.

5. Accept the pairing prompt on the intended physical TV. A saved `.key` file is
   a credential; keep it outside Git and photo folders.
6. Allow only the required temporary local-network traffic if prompted by a
   firewall. Do not disable the firewall or port-forward the server. Stop the
   temporary tool/server when its work is complete.
7. Check the actual TV/tool result. Pairing or downloading a page is not proof
   that root, persistence, or standard Homebrew Channel was installed.
8. After successful root, uninstall the LG Developer Mode app before rebooting
   if the rooting tool tells you it is present. Do not install that app while
   rooted, and do not remove Homebrew Channel.
9. Follow the selected method's completion/restart instructions. Confirm Homebrew
   opens with the intended privileges and that LG Home, settings, apps, inputs,
   and sound still work before continuing.

Do not add `--curl-insecure` or `curl -k`. A certificate failure calls for checking
the date, genuine source, and network, not disabling verification. If installation
fails, preserve the private log, determine what changed, and stop before retries
or resets. Share a redacted error summary, not keys or whole logs.

## Developer Mode Is A Different Path

Some rooting methods require Developer Mode first. Follow that method and
[LG's guide](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app):
use your own LG developer account, install Developer Mode through LG Apps, sign
in, enable it, complete its restart, and enable Key Server for your own client.
Keep its passphrase private and enter it directly in the tool's prompt.

Do not install Developer Mode on an already rooted TV. Its session can expire and
remove developer-installed apps. Developer Mode alone does not provide the
privileged inventory/artwork or native Home-profile changes used by this project.

If the checker recommends another root method, use that method's current
instructions. Do not mix its payload with this SlopBro procedure. Hardware
modifications and firmware flashing/downgrading are outside this guide.

## After Root

Set up your own protected client key and independently verify the TV's host key.
Remove shared/default access and disable Telnet when you do not need it. Keep
host verification enabled and protect the root connection as administrator access.

Then continue with [launcher setup](setup.md), [security](security.md), and the
separate [default Home guide](home.md). Removing ec1tv later does not itself unroot
the TV or restore original firmware.