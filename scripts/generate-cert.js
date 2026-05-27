const fs = require("fs");
const os = require("os");
const path = require("path");
const selfsigned = require("selfsigned");

const root = path.join(__dirname, "..");
const certDir = path.join(root, "certs");
const keyPath = path.join(certDir, "localhost-key.pem");
const certPath = path.join(certDir, "localhost-cert.pem");

function getIPv4Addresses() {
  const addresses = ["127.0.0.1"];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        addresses.push(entry.address);
      }
    }
  }
  return [...new Set(addresses)];
}

async function main() {
  const ips = getIPv4Addresses();
  const attrs = [{ name: "commonName", value: "image-file-transfer.local" }];
  const pems = await selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 2, value: "image-file-transfer.local" },
          ...ips.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });

  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private, "utf8");
  fs.writeFileSync(certPath, pems.cert, "utf8");

  console.log("Generated HTTPS certificate:");
  console.log(`  ${certPath}`);
  console.log(`  ${keyPath}`);
  console.log("Certificate covers:");
  for (const ip of ips) {
    console.log(`  https://${ip}:4443`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
