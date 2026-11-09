# Photos And Idle Display

Use the built-in backgrounds, connect your own OneDrive folder, or make a private
build with your own pictures. OneDrive is optional.

## Choose Your Settings

1. Open **Photos** at the top of the launcher.
2. Select **Next photo** to change the background.
3. Turn on **Slideshow** to change pictures automatically.
4. Choose whether **Auto-hide controls** should hide the app row and toolbar
   while you are not using them.
5. In **Menu**, turn on **Reduced motion** if you prefer fewer animations.

Keep **OneDrive photos** off until you complete the connection steps below.

With slideshow enabled, a picture stays visible for about 90 seconds after it
loads. The transition takes two seconds. Navigation and menus can pause a change.

Auto-hide moves the controls away after about one minute of inactivity. Your first
navigation, OK, or pointer click brings them back without launching an app.
This setting does not change the TV's system-level idle application.

## Create Your Microsoft Registration

You need your own personal Microsoft account, OneDrive storage, and permission
to register an application in a Microsoft Entra directory. Check Microsoft's
current registration eligibility if the portal refuses access.

1. Sign in directly to [Microsoft Entra](https://entra.microsoft.com/), using a
   directory you control or may administer.
2. Open **App registrations > New registration**. Name it **ec1tv Photos**, or
   choose your own name, and select **Personal accounts only**.
3. Record your **Application (client) ID** privately.
4. In **API permissions**, remove default `User.Read` if present. Add Microsoft
   Graph **Delegated permissions > Files.ReadWrite.AppFolder**.
5. In **Authentication**, enable **Allow public client flows** for device-code
   login. Do not create a client secret or a web redirect URL for this flow.

Use your own registration and account. Never copy a registration ID, saved token,
folder ID, or login from another person's setup. No hosted photo server is needed.

`Files.ReadWrite.AppFolder` permits reading, writing, and deleting within the
app-specific folder. The slideshow reads photos, but a stolen token has the
granted permission. Do not add whole-library file permissions to make a check pass.

## Connect Your Folder

1. Install launcher **0.1.16** on the TV first.
2. Run `npm run setup` and choose **Connect OneDrive photos**.
3. Confirm the TV is available and complete its verified SSH connection. Approve
   the private setup helper if prompted.
4. Enter your own client ID, personal Microsoft account email, and registration
   display name.
5. Open the Microsoft verification page shown in the terminal and enter its short
   code directly. Check the account and permissions on Microsoft's page. Do not
   paste the code, passwords, or tokens into chat or issues.
6. Review the account and actual app-folder location shown by setup. Confirm only
   if both are yours and correct.
7. Wait while the TV verifies its own login renewal and app-folder access.
8. Add pictures through your own OneDrive, then turn on **OneDrive photos** in the
   TV's Photos menu. Use **Refresh photos** when needed.

Microsoft creates or resolves the registration's special app folder, typically
`Apps/ec1tv Photos`. The actual name can vary; use the location setup shows. A
similarly named top-level folder is not the same folder. The setup does not scan
your whole photo library or use a public sharing link.

The computer keeps sign-in tokens only in memory during setup. The TV stores its
connection in `/var/lib/focus-stage-photos/connection.json`, protected by root-only
permissions. Those permissions restrict access; they are not encryption at rest.
The PC does not need to stay on for the slideshow.

## Check, Renew, Or Disconnect

Run `npm run setup` and choose **Check OneDrive photos** to check login renewal and
the app folder. To change accounts or renew a revoked/expired login, choose
**Disconnect OneDrive photos**, then **Connect OneDrive photos** and sign in again.

Disconnect removes the saved TV login, not your cloud pictures. Turn off OneDrive
photos in the TV menu afterward. You can also revoke the registration's access
through your own Microsoft account permissions. Revocation can affect other TVs
using that same registration/account, and issued access tokens can remain valid
until expiry.

If setup reports an uncertain result, check status before trying again. Keep the
root-private recovery files. An existing photo connection managed by another tool
will not be replaced.

## Cloud Photo Limits And Sharing

- Use direct image files in the app folder. Subfolders, linked libraries, and
  videos are not slideshow sources.
- Lists refresh roughly every five minutes while the launcher is visible.
  Pages hold up to 128 entries; this is not a 128-photo total limit.
- Display images are limited to two MiB and 1920 by 1080 pixels. Larger originals
  use suitable Microsoft previews where available.
- Pictures fill a 16:9 screen, so portraits can be cropped. Originals are not
  rewritten by the slideshow.
- Photos download again after a restart. Immediate offline personal-photo display
  is not guaranteed.
- Invite named people you trust if you want contributions. Folder edit permission
  can allow viewing, changing, sharing, and deleting, not just uploading.

Never store credentials or recovery files in the photo folder. People near the
TV can see the pictures, so choose the displayed content accordingly.

## Use Your Own Backgrounds

Make these changes in a private working copy of the project. Anyone with your
resulting app package can extract its background pictures, so share it only with
people who should receive those images.

1. Choose two pictures you own or have permission to use.
2. Export each as a 1920-by-1080 JPEG, preferably under two MiB. Keep your original
   photos separately. Landscape pictures fit the TV best; portraits will be cropped.
3. Replace these two files in your private working copy, keeping the filenames:

```text
webos-app/app/assets/lake-screen.jpg
webos-app/app/assets/gorge-screen.jpg
```

4. Update the image credits in your private copy to describe the actual pictures
   and their permissions. Do not credit your own pictures to the sample authors.
5. Run the [build and installation steps](setup.md), then install your package
   on your own TV. Keep a copy of the working package before replacing it.
6. Open Photos and check both images, slideshow, and auto-hide.

Keep personal images and packages out of public Git repositories and public
downloads. Changing packaged backgrounds requires building and installing the app
again; editing files on the computer does not update an installed TV app.

## Check The Result

Check that each picture fills the screen as intended, faces or important details
are not cropped, and the app controls remain readable. Wait for a slideshow change,
then test that the first wake-up input restores the controls without opening an app.

Return to the [overview](../README.md) or [installation checks](verification.md).

Microsoft references: [registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app),
[device-code login](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code),
and [app-folder permissions](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder).