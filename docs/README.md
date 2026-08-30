# HWMon private installer transfer

The public OTA artifacts intentionally have no fleet enrollment bootstrap key. A new Windows or
macOS computer therefore needs the private host package once. This directory provides a static
decrypt page for both platforms so only authenticated ciphertext is published.

Generate a new 32-byte key for each installer transfer and keep it outside the repository:

```sh
umask 077
node -e "process.stdout.write('base64url:' + require('node:crypto').randomBytes(32).toString('base64url') + '\\n')" \
  > /secure/local/path/hwmon-transfer.key
```

Encrypt and verify each private installer after `tools/package-release` has produced it. The release
packager creates both transfer pairs and verifies their persisted bytes before returning success.
The Windows command has this shape:

```sh
HWMON_TRANSFER_KEY_FILE=/secure/local/path/hwmon-transfer.key \
  tools/hwmon-transfer encrypt \
    --input dist/hwmon.exe \
    --version "$HWMON_RELEASE_VERSION" \
    --output-dir dist/hwmon-download \
    --mirror "https://github.com/$GITHUB_REPOSITORY/releases/download/$HWMON_RELEASE_TAG/HWMon.exe.enc.txt" \
    --mirror "https://$HWMON_DOWNLOAD_HOST/hwmon-download/$HWMON_RELEASE_VERSION/HWMon.exe.enc.txt"
```

The macOS package uses the same command with `dist/HWMon-macos-universal.zip`,
`HWMon-macos-universal.zip.enc.txt`, and `HWMon-macos-universal.zip.transfer.json`. The tool decrypts
the persisted output and compares it with the source package byte-for-byte. It never prints the
transfer key. Verify again at any point with:

```sh
HWMON_TRANSFER_KEY_FILE=/secure/local/path/hwmon-transfer.key \
  tools/hwmon-transfer verify \
    --metadata dist/hwmon-download/HWMon.exe.transfer.json \
    --expected dist/hwmon.exe
```

Publish only each ciphertext and JSON metadata pair. Never upload `dist/hwmon.exe`, the plaintext
macOS ZIP, or the transfer key. For GitHub Pages, publish `index.html`, `decrypt.js`,
`transfer-crypto.mjs`, and `styles.css`, then place both transfer pairs beside them. Keeping one
ciphertext copy beside the page avoids CORS; the Fly URLs remain fallback mirrors.

Mirror both generated pairs into the public static directory on Fly. The Fly route
should serve the text payload and JSON metadata over HTTPS, set an explicit Pages-origin CORS header
when the page fetches them cross-origin, and never contain the plaintext executable or key. The
metadata carries all mirror URLs, so the page tries the local copy, GitHub release asset, and Fly
copy in order.

The Windows recipient URL uses this shape:

```text
https://$HWMON_DOWNLOAD_HOST/hwmon-download/?manifest=./HWMon.exe.transfer.json&version=$HWMON_RELEASE_VERSION&sha256=$HWMON_WINDOWS_SHA256#key=$HWMON_TRANSFER_KEY_BASE64URL
```

The macOS link changes `manifest` to `./HWMon-macos-universal.zip.transfer.json` and pins the macOS
package SHA-256. `tools/hwmon-transfer link` writes either complete URL without printing its key.

Compose that URL locally. Send the fragment through an authenticated private channel and do not put
it in release notes, tickets, analytics, URL shorteners, or server configuration. Browsers do not
send the fragment in HTTP requests. The page removes it from the address bar immediately, decrypts
with Web Crypto AES-256-GCM, verifies the authenticated size and SHA-256, checks the Windows PE or
macOS ZIP signature, and only then offers the host package.

Run the non-GUI crypto regression with `tools/test-hwmon-transfer`.
