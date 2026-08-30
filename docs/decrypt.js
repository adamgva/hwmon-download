import {
  TransferError,
  decryptTransfer,
  fetchTextWithIdleTimeout,
  immutableFirstTransferURLs,
  pinnedTransferRequestFromSearch,
  trustedInstallerTransferURLs,
  transferKeyFromFragment,
  validatePinnedTransferMetadata,
} from './transfer-crypto.mjs';

const MAX_METADATA_TEXT = 64 * 1024;
const titleElement = document.querySelector('#download-title');
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
  const { text, responseURL } = await fetchTextWithIdleTimeout(url, maximumBytes);
  return { text, responseURL: allowedHTTPSURL(responseURL, url) };
}

async function loadMetadata() {
  const requestedURL = allowedHTTPSURL(transferRequest.manifest, location.href);
  const stableMetadataFiles = [
    'HWMon.exe.transfer.json',
    'HWMon-macos-universal.zip.transfer.json',
  ];
  const requestedLeaf = requestedURL.pathname.split('/').at(-1);
  const stableMetadataFile = stableMetadataFiles.find(
    (file) => requestedLeaf === file || requestedLeaf.endsWith(`-${file}`),
  );
  if (!stableMetadataFile) {
    throw new TransferError('transfer metadata URL does not identify a HWMon host');
  }
  const candidates = trustedInstallerTransferURLs(
    requestedURL.toString(),
    location.href,
    transferRequest.version,
    transferRequest.sha256,
    stableMetadataFile,
  ).map((candidate) => allowedHTTPSURL(candidate, location.href));
  let lastFailure;
  for (const candidate of candidates) {
    try {
      const { text, responseURL } = await fetchText(candidate, MAX_METADATA_TEXT);
      let metadata;
      try {
        metadata = JSON.parse(text);
      } catch {
        throw new TransferError('transfer metadata is not valid JSON');
      }
      const normalized = validatePinnedTransferMetadata(metadata, transferRequest);
      transferMetadata = metadata;
      manifestURL = responseURL;
      titleElement.textContent = `Download the ${normalized.plaintext.label}`;
      downloadButton.textContent = `Decrypt and download ${normalized.plaintext.file}`;
      versionElement.textContent = normalized.plaintext.version;
      hashElement.textContent = normalized.plaintext.sha256;
      sizeElement.textContent = `${normalized.plaintext.bytes.toLocaleString()} bytes`;
      return;
    } catch (error) {
      lastFailure = error;
    }
  }
  throw lastFailure || new TransferError('no transfer metadata mirror is available');
}

async function loadEncryptedPayload(normalized) {
  const maximumTextBytes = Math.ceil((normalized.payload.ciphertextBytes * 4) / 3) + 2;
  const candidates = immutableFirstTransferURLs(
    [normalized.payload.file, ...normalized.payload.urls],
    manifestURL,
    normalized.plaintext.version,
    normalized.plaintext.sha256,
    normalized.payload.file,
  );
  let lastFailure;
  for (const candidate of candidates) {
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
    setStatus('Encrypted host package ready. Decryption stays in this browser.');
  } catch (error) {
    if (transferKey) transferKey.fill(0);
    transferKey = undefined;
    setStatus(error instanceof Error ? error.message : 'Unable to load this transfer.', true);
  }
}

downloadButton.addEventListener('click', async () => {
  downloadButton.disabled = true;
  setStatus('Downloading and authenticating encrypted host package...');
  try {
    const normalized = validatePinnedTransferMetadata(transferMetadata, transferRequest);
    const payload = await loadEncryptedPayload(normalized);
    const result = await decryptTransfer(transferMetadata, payload, transferKey);
    const blob = new Blob([result.plaintext], {
      type: result.metadata.plaintext.mimeType,
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
