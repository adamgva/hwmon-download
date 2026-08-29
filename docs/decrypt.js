import {
  TransferError,
  decryptTransfer,
  pinnedTransferRequestFromSearch,
  transferKeyFromFragment,
  validatePinnedTransferMetadata,
} from './transfer-crypto.mjs';

const MAX_METADATA_TEXT = 64 * 1024;
const statusElement = document.querySelector('#status');
const versionElement = document.querySelector('#version');
const hashElement = document.querySelector('#sha256');
const sizeElement = document.querySelector('#size');
const downloadButton = document.querySelector('#decrypt-download');

let transferKey;
let transferMetadata;
let transferRequest;
let manifestURL;

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
}

function allowedHTTPSURL(value, baseURL) {
  const url = new URL(value, baseURL);
  if (url.username || url.password || url.hash) {
    throw new TransferError('download URLs must not contain credentials or fragments');
  }
  const sameLocalOrigin = url.origin === location.origin && url.protocol === location.protocol;
  if (url.protocol !== 'https:' && !sameLocalOrigin) {
    throw new TransferError('download URLs must use HTTPS');
  }
  return url;
}

async function fetchText(url, maximumBytes) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new TransferError(`download returned HTTP ${response.status}`);
  const responseURL = allowedHTTPSURL(response.url || url, url);
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new TransferError('download is larger than authenticated metadata permits');
  }
  if (!response.body) throw new TransferError('download returned no response body');
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel();
        throw new TransferError('download is larger than authenticated metadata permits');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
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
    throw new TransferError('download is not valid UTF-8 text');
  }
  return { text, responseURL };
}

async function loadMetadata() {
  const requestedURL = allowedHTTPSURL(transferRequest.manifest, location.href);
  const { text, responseURL } = await fetchText(requestedURL, MAX_METADATA_TEXT);
  let metadata;
  try {
    metadata = JSON.parse(text);
  } catch {
    throw new TransferError('transfer metadata is not valid JSON');
  }
  const normalized = validatePinnedTransferMetadata(metadata, transferRequest);
  transferMetadata = metadata;
  manifestURL = responseURL;
  versionElement.textContent = normalized.plaintext.version;
  hashElement.textContent = normalized.plaintext.sha256;
  sizeElement.textContent = `${normalized.plaintext.bytes.toLocaleString()} bytes`;
}

async function loadEncryptedPayload(normalized) {
  const maximumTextBytes = Math.ceil((normalized.payload.ciphertextBytes * 4) / 3) + 2;
  let lastFailure;
  for (const candidate of normalized.payload.urls) {
    try {
      const url = allowedHTTPSURL(candidate, manifestURL);
      return (await fetchText(url, maximumTextBytes)).text;
    } catch (error) {
      lastFailure = error;
    }
  }
  throw lastFailure || new TransferError('no encrypted payload mirror is available');
}

async function initialize() {
  try {
    const fragment = location.hash;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    transferKey = transferKeyFromFragment(fragment);
    transferRequest = pinnedTransferRequestFromSearch(location.search);
    await loadMetadata();
    downloadButton.disabled = false;
    setStatus('Encrypted installer ready. Decryption stays in this browser.');
  } catch (error) {
    if (transferKey) transferKey.fill(0);
    transferKey = undefined;
    setStatus(error instanceof Error ? error.message : 'Unable to load this transfer.', true);
  }
}

downloadButton.addEventListener('click', async () => {
  downloadButton.disabled = true;
  setStatus('Downloading and authenticating encrypted installer...');
  try {
    const normalized = validatePinnedTransferMetadata(transferMetadata, transferRequest);
    const payload = await loadEncryptedPayload(normalized);
    const result = await decryptTransfer(transferMetadata, payload, transferKey);
    const blob = new Blob([result.plaintext], {
      type: 'application/vnd.microsoft.portable-executable',
    });
    const objectURL = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectURL;
    link.download = result.metadata.plaintext.file;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 30_000);
    result.plaintext.fill(0);
    transferKey.fill(0);
    transferKey = undefined;
    setStatus(`Verified ${result.metadata.plaintext.file} and started the download.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Decryption failed.', true);
    downloadButton.disabled = false;
  }
});

initialize();
