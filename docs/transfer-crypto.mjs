const FORMAT = 'hwmon-private-installer-transfer';
const FORMAT_VERSION = 1;
const CIPHER = 'AES-256-GCM';
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 256 * 1024 * 1024;

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
  const normalizedPlaintext = {
    file: validateFileName(plaintext.file, '.exe'),
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
  if (plaintext[0] !== 0x4d || plaintext[1] !== 0x5a) {
    plaintext.fill(0);
    fail('decrypted artifact is not a Windows PE executable');
  }
  return { plaintext, metadata: normalized };
}
