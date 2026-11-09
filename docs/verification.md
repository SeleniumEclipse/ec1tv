# Check Your Installation

Run the computer checks before installing. Schedule TV checks for a time when
nobody else is watching or using its sound.

## Check The Build

From the project directory:

```powershell
npm ci --ignore-scripts
npm test
npm run package
```

`npm test` checks navigation, native-request handling, image limits, and package
validation using local test data. All tests must pass before you continue.

The package builder compares the app files with the packaged files and checks
package metadata and installation hooks. Read the final output to confirm the
app ID, version, package location, and SHA-256 checksum.

Check the package checksum yourself:

```powershell
Get-FileHash -Algorithm SHA256 webos-app/dist/io.focusstage.home_0.1.16_all.ipk
```

It should match the `sha256` value in
`webos-app/reports/io.focusstage.home_0.1.16_build.json`. Keep the package and its
checksum together. A checksum detects changed bytes; it does not prove a file is
trustworthy. Compare against a trusted release checksum when using a downloaded
package.

You can check the build dependencies for published advisories with `npm audit`.
Review its results before changing versions. Do not apply forced updates without
rerunning the tests and package checks.

## Check The Launcher On Your TV

1. Open **Focus Stage** from LG Home.
2. Check that the app list and HDMI inputs match your TV.
3. Move through the row with the remote and pointer. Open and close All Apps.
4. Hold a tile to reorder or hide it. Confirm that a hidden tile remains available
   in All Apps and can be restored to the row.
5. Open an app and wait for it to finish starting. Check picture and sound.
6. Open an HDMI input. Check picture, sound, and the normal volume controls.
7. Open Menu > TV settings, then Menu > Original LG Home.
8. Reopen the launcher and confirm your preferences are retained.

An installation success message is not a substitute for these checks.

## Check Home And Resume

Complete the [Home setup and backup steps](home.md) before changing the default.
Run `npm run setup` and use **Check connection and status** to check the saved state.

Test the physical Home button from an HDMI input, a fully started app, and LG
Home. If you use ThinQ, test its Home control separately.

Test ordinary standby/wake separately from a full restart. Confirm the TV resumes
the intended input or app and that Home opens the launcher. Use Back to close
launcher menus. Wait for another app to finish starting before testing Home.

Keep the original settings and a working administrator connection until you have
checked [restoration](recovery.md). Restore Home before removing the launcher.

## Check Photos

After guided OneDrive connection, run **Check OneDrive photos**. Confirm that it
verifies login renewal and the same app folder you approved. Add a picture through
your own OneDrive account and check that it appears on the TV. Do not share photo
names, account details, or sign-in output in support reports.

Turn on slideshow in Photos and leave the launcher visible. Check that pictures
advance and that navigation pauses changes when needed. Test reduced motion.

With auto-hide enabled, leave the controls idle for about one minute. Check that
they disappear and that your first navigation or OK press restores them without
launching an app.

Test disconnection through **Disconnect OneDrive photos**, confirm the TV login
is removed, then reconnect if desired. Cloud pictures should remain in your own
account throughout.

## Get Help

Record your app version, exact TV model, firmware, the step that failed, and the
error message. Remove account details, addresses, keys, codes, photos, and other
private information before sharing a support report. See [security](security.md).

Return to the [overview](../README.md).