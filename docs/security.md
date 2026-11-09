# Security And Private Storage

Use your own device connection, keys, and recovery records. Keep them in a private
folder outside the project. Do not add credentials to Git, even in a private repository.

## Keep Outside Git

| Data | Appropriate protection |
| --- | --- |
| SSH private key/passphrase | OS secret storage or a protected key file with user-only access; enter passphrases directly into prompts. |
| Encrypted private-key backup | Private backup storage too. Encryption does not make it public-source material. |
| Pairing key, TV address, MAC/serial, host pin | Private per-device setup records, not screenshots or examples. |
| Account/client/folder/drive identifiers | Private connection configuration; identifiers can reveal personal resources even when not passwords. |
| Tokens, cookies, signed URLs, authentication cache | Protected runtime storage, never the UI, source, photo folder, or support logs. |
| Original settings/files, transaction records | Private recovery storage until restoration/removal is complete. |
| Photos, logs, screenshots, traces | Private storage; share only synthetic/licensed examples or summaries with private details removed. |

Use a private, nonsynced directory. You can use the
[setup worksheet](../examples/setup-notes.example.json) to record the information
you need. Fill it in only in your private folder. It is a personal checklist,
not an app configuration file.

The guided setup stores connection settings under `%LOCALAPPDATA%/ec1tv` on Windows
with user/system access. It stores a reference to your SSH key, not its contents
or passphrase. Microsoft authentication stays in memory on the computer during
sign-in. TV recovery files are root-private under `/var/lib/ec1tv-setup`.

## Client Keys And TV Identity

The client key identifies you. The TV's host key identifies the server. They are
different, and both matter. Create a unique supported client key, keep its private
half on the computer, and enroll only its public half through a trusted process.
Preserve other authorized keys and verify ownership/permissions before changing
access. Do not use shared/rooting-project keys or someone else's saved login.

Obtain the TV host fingerprint through an independently trusted, physically
confirmed setup path. Collecting a key with `ssh-keyscan` alone does not establish
identity. Keep strict host verification and stop if a stored key changes. An IP
address, model name, or newly scanned key is not enough to silently replace it.

Do not put a passphrase in an `ares-setup-device` command line or a JSON example.
Command history and process arguments can reveal it. Use the supported interactive
prompt directly, without sending its value through chat or an issue.

## Network And Root Access

Do not forward TV SSH, Developer Mode, debugging, or temporary payload-server
ports through a router. Do not disable the firewall, TLS checks, or host verification
to make setup work. Stop temporary listeners after the approved setup activity.
No router, DNS, Pi-hole, or whole-network ad-blocking configuration is required.

Homebrew has powerful privileges. The launcher restricts its requests and file
reads, but that is not an audit of every Homebrew/debug/failsafe service or the
TV operating system. `inspectable: false` is not a complete security boundary.

## Personal Pictures

Use a private working copy when adding personal background images. Pictures inside
an app package can be extracted, so do not publish that package or copy unless
you intend to share the images. People near the TV can see displayed photos.

File permissions restrict who can open a file; they do not encrypt it. Protect
the computer account and the TV's administrator access, and secure backups too.

For OneDrive, create your own registration and use only the app-folder permission.
The TV keeps its refresh/access tokens in root-owned mode-0600
`/var/lib/focus-stage-photos/connection.json`, under a mode-0700 directory. Keep
tokens out of photo folders, source, support reports, and command arguments.

Run guided sign-in directly in your terminal and enter the device code only on
Microsoft's verification page. Check the displayed account and actual app folder
before confirming. The permission allows writes/deletion within that folder, even
though the slideshow normally reads. Use **Disconnect OneDrive photos** to remove
the TV login, then revoke Microsoft consent separately if desired.

## Build And Supply-Chain Limits

The LG CLI is a local development dependency, not code shipped inside the TV
payload. The project pins it and uses integrity-checked locked dependencies,
keeps TLS on, and disables dependency lifecycle scripts. Those are useful controls,
not a full dependency-security review.

Run `npm audit` to check published dependency advisories. Review warnings before
upgrading, then rerun the tests and package checks. See [installation checks](verification.md).
Build logs can contain local paths; review them before sharing.

## Safe Support Summaries

Include app version, exact model/firmware, a sanitized error, the failed checkpoint,
and whether recovery passed. Exclude network identities, account details, tokens,
cookies, pairing codes, signed URLs, photos, private paths, and raw reports.
Review screenshots and hidden metadata before sharing; visible cropping alone
does not sanitize a file.

## Sharing Your Copy

Review files, packages, screenshots, and Git changes before sharing them. An
ignore rule does not remove information already committed to Git. If a credential
has been exposed, revoke or replace it and check all published copies.

Keep your recovery information until you have restored the TV and confirmed that
the launcher can be removed safely.

Return to the [overview](../README.md).