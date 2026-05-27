# QR File Transfer

QR File Transfer is a pure front-end web app for sending files through animated QR frames. One device displays frames, and another device scans them with a camera or imports screenshots to reconstruct the original file.

No backend server is required. The app can run from a static host such as GitHub Pages.

## Features

- Pure static HTML/CSS/JavaScript
- Dynamic QR frame playback
- Camera scanning with missing-frame recovery
- Screenshot import fallback
- Adjustable chunk size, frame interval, and QR error correction level
- Optional frame filter for replaying specific missing frames
- Local vendor bundles, no CDN required at runtime

## Live Deployment

Enable GitHub Pages for the repository and serve the `public/` folder.

Recommended Pages setting:

```text
Source: Deploy from a branch
Branch: main
Folder: /public
```

Then open the generated GitHub Pages HTTPS URL on both devices.

Mobile camera access normally requires HTTPS, so GitHub Pages is a better fit than opening the file directly from disk.

## Local Use

You can open `public/index.html` directly in a browser for the sender. For receiver camera scanning, use an HTTPS host or `localhost`.

A quick local static server is optional:

```powershell
npx http-server public
```

## Usage

1. Open the app on the sending device and stay on the **发送** tab.
2. Choose a file.
3. Open the same app URL on the receiving device and switch to **接收**.
4. Start the camera and point it at the sender screen.
5. Keep playback looping until all frames are received.
6. Click **下载文件** when the receiver reaches 100%.

## Tuning

The defaults favor reliability over speed:

- Chunk size: `1400` bytes
- Frame interval: `450 ms`
- Error correction: `M`

If scanning is stable, try a shorter frame interval such as `250-350 ms`. If frames are hard to scan, increase the interval or use stronger error correction.

If the receiver reports missing frames, enter a list such as:

```text
5,12-20
```

in the sender frame filter and replay only those frames.

## Rebuilding Vendor Files

The committed files in `public/vendor/` are enough for runtime use. To rebuild the QRCode browser bundle:

```powershell
npm install
npm run build:vendor
```

`public/vendor/jsQR.js` is copied from `node_modules/jsqr/dist/jsQR.js`.

## Security Notes

- The app is intended for trusted local or private use.
- File payloads are encoded into visible QR frames.
- Anyone who can see or record the sender screen may be able to reconstruct the file.
- No file data is uploaded to a server by this app.

## Project Structure

```text
public/
  index.html        App UI
  app.js            Sender/receiver logic
  styles.css        Styling
  vendor/           Browser QR libraries
package.json        Development scripts
```
