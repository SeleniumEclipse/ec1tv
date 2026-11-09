# Configure The Home Button

Complete [launcher installation](setup.md), check your [model and firmware](rooting.md),
and keep LG Home installed. Use a time when nobody else is watching the TV.

## Set Up Home

1. Run `npm run setup` in an interactive terminal.
2. Choose **Check connection and status** and complete your own TV connection
   settings. Verify the TV fingerprint before trusting the connection.
3. Run setup again and choose **Use ec1tv as Home**.
4. Confirm the TV is available. If prompted, approve installing the setup helper
   and private recovery folder on this TV.
5. Choose whether to use ec1tv as the **system idle app** too. Start with Home
   only if you want to check each change separately.
6. Confirm the Home change. Wait for the result before closing the terminal.

The helper saves your original settings before changing Home. It sets only the
saved Home destination and the matching native profile, preserving other defaults,
display categories, and startup policy. Its owned profile file is:

```text
/var/webos-profile/override/io.ec1tv.home.json
```

Recovery information is kept in the root-private `/var/lib/ec1tv-setup` directory
on the TV. Keep it and the matching project version until you finish recovery or
removal. Do not edit the recovery JSON or delete its files by hand.

The **Photos > Auto-hide controls** setting only hides the launcher's controls
after inactivity. It is separate from the TV's system idle application. Power-on
may still resume an HDMI input or another app; Home configuration does not replace
every resume action.

## Check The Result

Press physical Home from an HDMI input, a fully started app, and LG Home. Check
picture and sound. Test ThinQ separately if you use it.

Use Back to close launcher menus. Wait for another app to finish starting before
pressing Home, so it does not take input back during launch.

Test ordinary standby/wake separately from a full restart. Check that the intended
input/app resumes and that pressing Home opens a usable launcher.

Run **Check connection and status** to verify the stored configuration. A successful
setup message is not a substitute for checking the physical remote and screen.

## Restore LG Home

1. Run `npm run setup` and choose **Restore LG Home**.
2. Confirm the TV is available and approve restoration.
3. Wait for confirmation that the original settings have been restored.
4. Test physical Home, app/input resume, and sound before removing the launcher.

The helper removes only its matching profile override and restores the original
saved defaults. It refuses to overwrite an unrelated file or settings change.
Restoration can still run if the launcher has been updated or removed.

Menu > Original LG Home only opens the LG interface; it does not undo stored
configuration. Use the guided restore action for that.

## Change The Idle Choice

Restore LG Home first, check the result, then choose **Use ec1tv as Home** again
with the idle option you want. Do not replace the original recovery record with
guessed values.

## If Setup Stops

If the helper reports that it restored the original settings, check LG Home before
trying again. If a timeout or interrupted connection leaves the result uncertain,
use **Check connection and status**, then **Restore LG Home**. Do not repeat the
apply step blindly.

An existing Home setup managed by another tool needs its own recovery procedure.
This helper will not take it over or replace its files. If a hash or settings
check fails, keep the recovery folder intact and investigate the difference.
Do not force a writable system mount or delete the entire override directory.

Continue with [removal and recovery](recovery.md) or return to the [overview](../README.md).