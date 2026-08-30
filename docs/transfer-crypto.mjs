const FORMAT = 'hwmon-private-installer-transfer';
const FORMAT_VERSION = 1;
const CIPHER = 'AES-256-GCM';
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 256 * 1024 * 1024;
const DOWNLOAD_IDLE_TIMEOUT_MILLISECONDS = 12_000;

export class TransferError extends Error {}

function fail(message) {
  throw new TransferError(message);
}

function decodeBase64URL(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail(`${label} is not unpadded base64url`);
  }
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  let binary;
  try {
    binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  } catch {
    fail(`${label} is not valid base64url`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64URL(bytes) !== value) fail(`${label} is not canonical base64url`);
  return bytes;
}

function encodeBase64URL(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function validateVersion(value) {
  if (typeof value !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(value)) {
    fail('installer version is invalid');
  }
  return value;
}

function validateSHA256(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail('installer SHA-256 is invalid');
  }
  return value;
}

function validateFileName(value, extension) {
  if (
    typeof value !== 'string'
    || !/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(value)
    || value.includes('/')
    || value.includes('\\')
    || !value.toLowerCase().endsWith(extension)
  ) {
    fail(`installer ${extension} file name is invalid`);
  }
  return value;
}

const TRANSFER_RESOURCE_FILES = new Set([
  'HWMon.exe.enc.txt',
  'HWMon.exe.transfer.json',
  'HWMon-macos-universal.zip.enc.txt',
  'HWMon-macos-universal.zip.transfer.json',
]);

export const TRUSTED_INSTALLER_TRANSFER_DIRECTORIES = Object.freeze([
  'https://adamgva.github.io/hwmon-download/',
  'https://agalyoon-connect-sjc.fly.dev/download/installer/',
  'https://agalyoon-connect.fly.dev/download/installer/',
  'https://agalyoon-remote-connect.fly.dev/download/installer/',
]);

export function immutableTransferFileName(version, sha256, stableFileName) {
  const normalizedVersion = validateVersion(version);
  const normalizedSHA256 = validateSHA256(sha256);
  if (!TRANSFER_RESOURCE_FILES.has(stableFileName)) {
    fail('transfer resource file name is invalid');
  }
  return `${normalizedVersion}-${normalizedSHA256}-${stableFileName}`;
}

export function immutableTransferURL(value, baseURL, version, sha256, stableFileName) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    fail('transfer resource URL is invalid');
  }
  const immutableFileName = immutableTransferFileName(
    version,
    sha256,
    stableFileName,
  );
  let url;
  try {
    url = new URL(value, baseURL);
  } catch {
    fail('transfer resource URL is invalid');
  }
  if (url.username || url.password || url.hash) {
    fail('transfer resource URL contains credentials or a fragment');
  }
  const components = url.pathname.split('/');
  const leaf = components.at(-1);
  if (leaf === stableFileName) {
    components[components.length - 1] = immutableFileName;
    url.pathname = components.join('/');
  } else if (leaf !== immutableFileName) {
    fail('transfer resource URL does not identify the expected file');
  }
  return url.toString();
}

export function immutableFirstTransferURLs(values, baseURL, version, sha256, stableFileName) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 17) {
    fail('transfer resource URL list is invalid');
  }
  const immutable = [];
  const stable = [];
  for (const value of values) {
    try {
      immutable.push(immutableTransferURL(
        value,
        baseURL,
        version,
        sha256,
        stableFileName,
      ));
    } catch {
      // Keep nonstandard authenticated-payload mirrors as stable fallbacks.
    }
    stable.push(value);
  }
  return [...new Set([...immutable, ...stable])];
}

export function trustedInstallerTransferURLs(
  requestedURL,
  baseURL,
  version,
  sha256,
  stableFileName,
) {
  return immutableFirstTransferURLs(
    [
      requestedURL,
      ...TRUSTED_INSTALLER_TRANSFER_DIRECTORIES.map(
        (directory) => new URL(stableFileName, directory).toString(),
      ),
    ],
    baseURL,
    version,
    sha256,
    stableFileName,
  );
}

export async function fetchTextWithIdleTimeout(
  url,
  maximumBytes,
  {
    fetchFunction = globalThis.fetch,
    idleTimeoutMilliseconds = DOWNLOAD_IDLE_TIMEOUT_MILLISECONDS,
  } = {},
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    fail('download byte limit is invalid');
  }
  if (
    !Number.isSafeInteger(idleTimeoutMilliseconds)
    || idleTimeoutMilliseconds <= 0
    || idleTimeoutMilliseconds > 60_000
  ) {
    fail('download idle timeout is invalid');
  }
  if (typeof fetchFunction !== 'function') fail('download fetch function is unavailable');

  const controller = new AbortController();
  let deadline;
  let deadlineExpired = false;
  let deadlineTimer;
  function resetDeadline() {
    clearTimeout(deadlineTimer);
    deadlineExpired = false;
    deadline = new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => {
        deadlineExpired = true;
        controller.abort();
        reject(new TransferError('download timed out waiting for network data'));
      }, idleTimeoutMilliseconds);
    });
  }
  async function waitForProgress(operation) {
    try {
      return await Promise.race([operation, deadline]);
    } catch (error) {
      if (deadlineExpired) {
        throw new TransferError('download timed out waiting for network data');
      }
      throw error;
    }
  }

  let reader;
  try {
    // Fetch headers and the first body byte share one deadline. Only a non-empty
    // body chunk resets it, so a response that stalls after headers still falls back.
    resetDeadline();
    const response = await waitForProgress(fetchFunction(url, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    }));
    if (!response.ok) fail(`download returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      fail('download is larger than authenticated metadata permits');
    }
    if (!response.body) fail('download returned no response body');
    reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    while (true) {
      const { done, value } = await waitForProgress(reader.read());
      if (done) break;
      if (value.byteLength === 0) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        controller.abort();
        fail('download is larger than authenticated metadata permits');
      }
      chunks.push(value);
      resetDeadline();
    }
    const bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('download is not valid UTF-8 text');
    }
    return { text, responseURL: response.url || url };
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // An aborted fetch may reject its pending read just after this function returns.
      }
    }
  }
}

function validateHostArtifact(value) {
  switch (value) {
    case 'HWMon.exe':
      return {
        file: value,
        kind: 'windows-exe',
        label: 'Windows host',
        mimeType: 'application/vnd.microsoft.portable-executable',
      };
    case 'HWMon-macos-universal.zip':
      return {
        file: value,
        kind: 'macos-zip',
        label: 'Mac host',
        mimeType: 'application/zip',
      };
    default:
      fail('host artifact file name is invalid');
  }
}

function hasExpectedArtifactSignature(bytes, kind) {
  if (kind === 'windows-exe') {
    return bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
  }
  if (kind === 'macos-zip') {
    return bytes.length >= 4
      && bytes[0] === 0x50
      && bytes[1] === 0x4b
      && (
        (bytes[2] === 0x03 && bytes[3] === 0x04)
        || (bytes[2] === 0x05 && bytes[3] === 0x06)
        || (bytes[2] === 0x07 && bytes[3] === 0x08)
      );
  }
  return false;
}

function authenticatedMetadata(plaintext, ciphertextBytes) {
  return {
    format: FORMAT,
    format_version: FORMAT_VERSION,
    cipher: CIPHER,
    tag_bits: TAG_BYTES * 8,
    plaintext_file: plaintext.file,
    plaintext_version: plaintext.version,
    plaintext_bytes: plaintext.bytes,
    plaintext_sha256: plaintext.sha256,
    ciphertext_bytes: ciphertextBytes,
  };
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function hexadecimal(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function transferKeyFromFragment(fragment) {
  if (typeof fragment !== 'string' || !fragment.startsWith('#')) {
    fail('the transfer key is missing from the URL fragment');
  }
  const parameters = new URLSearchParams(fragment.slice(1));
  const keys = [...parameters.keys()];
  if (keys.length !== 1 || keys[0] !== 'key' || parameters.getAll('key').length !== 1) {
    fail('the URL fragment must contain exactly one key value');
  }
  const key = decodeBase64URL(parameters.get('key'), 'transfer key');
  if (key.length !== 32) fail('the transfer key must contain exactly 32 bytes');
  return key;
}

export function pinnedTransferRequestFromSearch(search) {
  if (typeof search !== 'string' || !search.startsWith('?')) {
    fail('the URL query must contain exactly one manifest, version, and sha256 value');
  }
  const parameters = new URLSearchParams(search.slice(1));
  const allowedNames = new Set(['manifest', 'version', 'sha256']);
  const names = [...parameters.keys()];
  if (
    names.length !== allowedNames.size
    || names.some((name) => !allowedNames.has(name))
    || [...allowedNames].some((name) => parameters.getAll(name).length !== 1)
  ) {
    fail('the URL query must contain exactly one manifest, version, and sha256 value');
  }

  const manifest = parameters.get('manifest');
  if (typeof manifest !== 'string' || manifest.length === 0 || manifest.length > 2048) {
    fail('transfer metadata URL is invalid');
  }
  return {
    manifest,
    version: validateVersion(parameters.get('version')),
    sha256: validateSHA256(parameters.get('sha256')),
  };
}

export function validateTransferMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('transfer metadata is invalid');
  }
  if (metadata.format !== FORMAT || metadata.format_version !== FORMAT_VERSION) {
    fail('this transfer format is not supported');
  }
  if (
    !metadata.cipher
    || metadata.cipher.name !== CIPHER
    || metadata.cipher.tag_bits !== TAG_BYTES * 8
  ) {
    fail('this transfer cipher is not supported');
  }
  const nonce = decodeBase64URL(metadata.cipher.nonce_base64url, 'AES-GCM nonce');
  if (nonce.length !== 12) fail('the AES-GCM nonce has the wrong size');

  const plaintext = metadata.plaintext;
  if (!plaintext || typeof plaintext !== 'object' || Array.isArray(plaintext)) {
    fail('plaintext metadata is missing');
  }
  const artifact = validateHostArtifact(plaintext.file);
  const normalizedPlaintext = {
    ...artifact,
    version: validateVersion(plaintext.version),
    bytes: plaintext.bytes,
    sha256: validateSHA256(plaintext.sha256),
  };
  if (
    !Number.isSafeInteger(normalizedPlaintext.bytes)
    || normalizedPlaintext.bytes < 2
    || normalizedPlaintext.bytes > MAX_PLAINTEXT_BYTES
  ) {
    fail('installer byte count is invalid');
  }
  const payload = metadata.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('encrypted payload metadata is missing');
  }
  if (payload.encoding !== 'base64url') fail('encrypted payload encoding is unsupported');
  const payloadFile = validateFileName(payload.file, '.txt');
  if (
    !Number.isSafeInteger(payload.ciphertext_bytes)
    || payload.ciphertext_bytes !== normalizedPlaintext.bytes + TAG_BYTES
  ) {
    fail('encrypted payload byte count is invalid');
  }
  if (!Array.isArray(payload.urls) || payload.urls.length === 0 || payload.urls.length > 16) {
    fail('encrypted payload mirror list is invalid');
  }
  const payloadURLs = payload.urls.map((value) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || value.includes('#')) {
      fail('an encrypted payload mirror URL is invalid');
    }
    return value;
  });

  const aad = decodeBase64URL(
    metadata.authenticated_metadata_base64url,
    'authenticated metadata',
  );
  let aadObject;
  try {
    aadObject = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(aad));
  } catch {
    fail('authenticated metadata is invalid');
  }
  const expectedAAD = new TextEncoder().encode(
    JSON.stringify(authenticatedMetadata(normalizedPlaintext, payload.ciphertext_bytes)),
  );
  if (!equalBytes(aad, expectedAAD)) {
    fail('public metadata does not match authenticated metadata');
  }
  if (JSON.stringify(aadObject) !== new TextDecoder().decode(expectedAAD)) {
    fail('authenticated metadata is not canonical');
  }
  return {
    nonce,
    aad,
    plaintext: normalizedPlaintext,
    payload: {
      file: payloadFile,
      urls: payloadURLs,
      ciphertextBytes: payload.ciphertext_bytes,
    },
  };
}

export function validatePinnedTransferMetadata(metadata, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    fail('private link installer pins are invalid');
  }
  const expectedVersion = validateVersion(request.version);
  const expectedSHA256 = validateSHA256(request.sha256);
  const normalized = validateTransferMetadata(metadata);
  if (normalized.plaintext.version !== expectedVersion) {
    fail('transfer metadata version does not match this private link');
  }
  if (normalized.plaintext.sha256 !== expectedSHA256) {
    fail('transfer metadata SHA-256 does not match this private link');
  }
  return normalized;
}

export function decodePayloadText(value, expectedBytes) {
  if (typeof value !== 'string') fail('encrypted payload is not text');
  const normalized = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (normalized.trim() !== normalized || /\s/.test(normalized)) {
    fail('encrypted payload must contain one canonical base64url line');
  }
  const bytes = decodeBase64URL(normalized, 'encrypted payload');
  if (bytes.length !== expectedBytes) fail('encrypted payload size does not match metadata');
  return bytes;
}

export async function decryptTransfer(metadata, payloadText, keyBytes) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) {
    fail('the transfer key has the wrong size');
  }
  if (!globalThis.crypto?.subtle) fail('Web Crypto is unavailable in this browser');
  const normalized = validateTransferMetadata(metadata);
  const encrypted = decodePayloadText(payloadText, normalized.payload.ciphertextBytes);
  let plaintextBuffer;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    plaintextBuffer = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: normalized.nonce,
        additionalData: normalized.aad,
        tagLength: TAG_BYTES * 8,
      },
      key,
      encrypted,
    );
  } catch {
    fail('the transfer key or encrypted payload failed AES-GCM authentication');
  }
  const plaintext = new Uint8Array(plaintextBuffer);
  if (plaintext.length !== normalized.plaintext.bytes) {
    plaintext.fill(0);
    fail('decrypted installer size does not match authenticated metadata');
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', plaintext));
  if (hexadecimal(digest) !== normalized.plaintext.sha256) {
    plaintext.fill(0);
    fail('decrypted installer SHA-256 does not match authenticated metadata');
  }
  if (!hasExpectedArtifactSignature(plaintext, normalized.plaintext.kind)) {
    plaintext.fill(0);
    fail(`decrypted artifact is not a valid ${normalized.plaintext.label} package`);
  }
  return { plaintext, metadata: normalized };
}
