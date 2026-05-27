# Security Policy

This project is designed for short-lived transfers on a trusted local network.

## Do Not Commit Secrets

The HTTPS certificate generator writes files into `certs/`:

```text
certs/localhost-cert.pem
certs/localhost-key.pem
```

The private key must stay local. The entire `certs/` directory is ignored by git.

## Network Exposure

By default the server listens on `0.0.0.0` so phones and other devices on the same LAN can connect. Do not expose this server directly to the public Internet.

To restrict the server to the current machine:

```powershell
$env:HOST="127.0.0.1"
npm start
```

## Data Visibility

Files are encoded into visible QR frames. Anyone who can see or record the sender screen may be able to reconstruct the file.
