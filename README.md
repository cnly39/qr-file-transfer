# Image File Transfer

Image File Transfer is a local web tool for sending files through animated QR-image frames. One device displays the generated frames, and another device scans them with a camera or imports screenshots to reconstruct the original file.

It is useful for restricted environments where normal network file transfer is unavailable, but it is not intended to be fast. A 20 MB file can take many minutes depending on camera quality, display brightness, frame interval, and error correction level.

## Features

- Browser-based sender and receiver UI
- Dynamic QR frame playback
- Camera scanning with missing-frame recovery
- Screenshot import fallback
- HTTP server for LAN access
- Optional self-signed HTTPS server for mobile camera access
- Adjustable chunk size, frame interval, and QR error correction level
- Optional frame filter for replaying specific missing frames

## Requirements

- Node.js 18 or newer
- A modern browser
- Camera permission on the receiving device

## Install

```powershell
npm install
```

## Run With HTTP

```powershell
npm start
```

The server listens on all interfaces by default and prints local and LAN URLs such as:

```text
http://127.0.0.1:4177
http://192.168.1.23:4177
```

Use the LAN URL from another device on the same network.

## Run With HTTPS

Mobile browsers usually require HTTPS before they allow camera access from a LAN page. Generate a local self-signed certificate first:

```powershell
npm run cert
npm start
```

The HTTPS server uses port `4443` by default and prints URLs such as:

```text
https://127.0.0.1:4443
https://192.168.1.23:4443
```

Because the certificate is self-signed, the browser will warn that the page is not trusted. Continue only on your own private network. If the phone still refuses camera access, install `certs/localhost-cert.pem` as a trusted certificate on the receiving device or use a real domain certificate.

## Usage

1. Open the app on the sending device and stay on the **Send** tab.
2. Choose a file.
3. Open the same app URL on the receiving device and switch to the **Receive** tab.
4. Start the camera and point it at the sender screen.
5. Keep playback looping until all frames are received.
6. Click **Download file** when the receiver reaches 100%.

## Tuning

The defaults favor reliability over speed:

- Chunk size: `1400` bytes
- Frame interval: `450 ms`
- Error correction: `M`

If scanning is stable, try a shorter frame interval such as `250-350 ms`. If frames are hard to scan, increase the interval or use stronger error correction. If the receiver reports missing frames, enter a list such as `5,12-20` in the sender frame filter and replay only those frames.

## Security Notes

- Generated certificates and private keys are local artifacts and are ignored by git.
- Do not commit `certs/localhost-key.pem`.
- The app is intended for trusted LAN use, not public Internet exposure.
- The file payload is visible to anyone who can record or scan the displayed frames.

## Scripts

```powershell
npm run cert   # Generate a local self-signed HTTPS certificate
npm start      # Start HTTP and HTTPS servers when a cert exists
npm run build:exe # Optional: build a Windows executable into dist/
```

## Project Structure

```text
public/                 Browser UI
scripts/generate-cert.js Self-signed certificate generator
server.js               HTTP/HTTPS server and QR generation API
package.json            Scripts and dependencies
```
