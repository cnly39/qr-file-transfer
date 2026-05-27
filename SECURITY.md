# Security Policy

QR File Transfer is a static browser app. It does not upload file data to a backend server.

## Data Visibility

Files are encoded into visible QR frames. Anyone who can see, record, photograph, or scan the sender screen may be able to reconstruct the transferred file.

## Hosting

Use HTTPS when receiving with a camera, especially on mobile browsers. GitHub Pages is suitable because it serves static files over HTTPS.

## Scope

This project is meant for trusted local, private, or offline-adjacent workflows. Do not use it as a secure transport for highly sensitive files unless you encrypt the file before transfer.
