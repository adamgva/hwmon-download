# HWMon private installer transfer

The public OTA executable intentionally has no fleet enrollment bootstrap key. A new Windows PC
therefore needs the private `dist/hwmon.exe` once. This directory provides a static decrypt page and
an offline encryption tool so only authenticated ciphertext is published.

Generate a new 32-byte key for each installer transfer and keep it outside the repository:

```sh
umask 077
node -e "process.stdout.write('base64url:' + require('node:crypto').randomBytes(32).toString('base64url') + '\\n')" \
  > /secure/local/path/hwmon-transfer.key
```

Encrypt and verify the private installer after `tools/package-release` has produced it:

```sh
HWMON_TRANSFER_KEY_FILE=/secure/local/path/hwmon-transfer.key \
  tools/hwmon-transfer encrypt \
    --input dist/hwmon.exe \
    --version "$HWMON_RELEASE_VERSION" \
    --output-dir dist/hwmon-download \
    --mirror "https://github.com/$GITHUB_REPOSITORY/releases/download/$HWMON_RELEASE_TAG/HWMon.exe.enc.txt" \
    --mirror "https://$HWMON_DOWNLOAD_HOST/hwmon-download/$HWMON_RELEASE_VERSION/HWMon.exe.enc.txt"
```

The command writes `HWMon.exe.enc.txt` and `HWMon.exe.transfer.json`, decrypts the persisted output,
and compares it with `dist/hwmon.exe` byte-for-byte before returning success. It never prints the
transfer key. Verify again at any point with:

```sh
HWMON_TRANSFER_KEY_FILE=/secure/local/path/hwmon-transfer.key \
  tools/hwmon-transfer verify \
    --metadata dist/hwmon-download/HWMon.exe.transfer.json \
    --expected dist/hwmon.exe
```

Publish only the ciphertext and JSON metadata. Never upload `dist/hwmon.exe` or the transfer key.
For a GitHub release, upload the two generated files as release assets with `gh release upload`.
For GitHub Pages, publish `index.html`, `decrypt.js`, `transfer-crypto.mjs`, and `styles.css`, then
place the generated metadata beside them. Keeping one ciphertext copy beside the page avoids CORS;
the release URL remains a fallback mirror.

Mirror the same two generated files into a versioned public static directory on Fly. The Fly route
should serve the text payload and JSON metadata over HTTPS, set an explicit Pages-origin CORS header
when the page fetches them cross-origin, and never contain the plaintext executable or key. The
metadata carries all mirror URLs, so the page tries the local copy, GitHub release asset, and Fly
copy in order.

The recipient URL uses this shape:

```text
https://$HWMON_DOWNLOAD_HOST/hwmon-download/?manifest=./HWMon.exe.transfer.json#key=$HWMON_TRANSFER_KEY_BASE64URL
```

Compose that URL locally. Send the fragment through an authenticated private channel and do not put
it in release notes, tickets, analytics, URL shorteners, or server configuration. Browsers do not
send the fragment in HTTP requests. The page removes it from the address bar immediately, decrypts
with Web Crypto AES-256-GCM, verifies the authenticated size and SHA-256, checks for a Windows PE
header, and only then offers `HWMon.exe`.

Run the non-GUI crypto regression with `tools/test-hwmon-transfer`.
