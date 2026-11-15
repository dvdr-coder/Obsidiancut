export interface DownloadResult {
  ok: boolean;
  bytes: number;
  error?: string;
}

const RANGE_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB keeps every HTTP response well below Cloud Run's 32 MB cap

function guessVideoMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

function triggerAnchorDownload(href: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 250);
}

function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(header);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

async function fetchWithSingleRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status >= 500) {
    // One brief retry for transient gateway blips
    await new Promise((r) => setTimeout(r, 250));
    return fetch(url, init);
  }
  return res;
}

/**
 * Reliably downloads a completed render of arbitrary size inside Cloud Run proxies
 * (via 4 MB HTTP Range chunks), desktop/mobile browsers, and sandboxed iframes.
 */
export async function downloadRenderedVideo(
  jobId: string,
  fileName: string,
  onProgress?: (pct: number) => void,
): Promise<DownloadResult> {
  const safeName = fileName || `obsidiancut_export_${jobId.slice(0, 8)}.mp4`;
  const url = `/api/render/${encodeURIComponent(jobId)}/download`;

  // Android WebView DownloadManager requires http/https URLs rather than blob: URLs
  const isAndroidWebView =
    typeof navigator !== 'undefined' &&
    /Android/i.test(navigator.userAgent) &&
    /; wv\)/i.test(navigator.userAgent);

  if (isAndroidWebView) {
    triggerAnchorDownload(url, safeName);
    onProgress?.(100);
    return { ok: true, bytes: 0 };
  }

  try {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    let totalBytes: number | null = null;
    let mime = guessVideoMime(safeName);

    const firstRes = await fetchWithSingleRetry(url, {
      cache: 'no-store',
      headers: { Range: `bytes=0-${RANGE_CHUNK_BYTES - 1}` },
    });

    if (!firstRes.ok && firstRes.status !== 206) {
      let errMsg = `Download failed (HTTP ${firstRes.status})`;
      try {
        const json = (await firstRes.json()) as { error?: string };
        if (json?.error) errMsg = json.error;
      } catch {
        // ignore non-JSON error body
      }
      return { ok: false, bytes: 0, error: errMsg };
    }

    const firstType = firstRes.headers.get('Content-Type');
    if (firstType && !firstType.includes('application/json')) {
      mime = firstType;
    }

    if (firstRes.status === 206) {
      totalBytes = parseContentRangeTotal(firstRes.headers.get('Content-Range'));
      const firstBuf = await firstRes.arrayBuffer();
      const firstArr = new Uint8Array(firstBuf);
      if (firstArr.byteLength > 0) {
        chunks.push(firstArr);
        received += firstArr.byteLength;
      }
      if (totalBytes && totalBytes > 0) {
        onProgress?.(Math.min(99, Math.round((received / totalBytes) * 100)));
      }

      // Fetch remaining chunks sequentially so Cloud Run stays well under 32 MB per request
      while (totalBytes !== null && received < totalBytes) {
        const nextEnd = Math.min(totalBytes - 1, received + RANGE_CHUNK_BYTES - 1);
        const partRes = await fetchWithSingleRetry(url, {
          cache: 'no-store',
          headers: { Range: `bytes=${received}-${nextEnd}` },
        });

        if (partRes.status !== 206 && !partRes.ok) {
          return {
            ok: false,
            bytes: received,
            error: `Chunk download failed at byte ${received} (HTTP ${partRes.status})`,
          };
        }

        const partBuf = await partRes.arrayBuffer();
        const partArr = new Uint8Array(partBuf);
        if (partArr.byteLength === 0) {
          break;
        }
        chunks.push(partArr);
        received += partArr.byteLength;
        onProgress?.(Math.min(99, Math.round((received / totalBytes) * 100)));
      }
    } else {
      // Server returned 200 full body (e.g., direct single stream for smaller file)
      const expected = Number(firstRes.headers.get('Content-Length') || '0');
      if (firstRes.body && typeof firstRes.body.getReader === 'function' && expected > 0) {
        const reader = firstRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            const copy = new Uint8Array(value.byteLength);
            copy.set(value);
            chunks.push(copy);
            received += value.byteLength;
            onProgress?.(Math.min(99, Math.round((received / expected) * 100)));
          }
        }
      } else {
        const fullBuf = await firstRes.arrayBuffer();
        const fullArr = new Uint8Array(fullBuf);
        if (fullArr.byteLength > 0) {
          chunks.push(fullArr);
          received = fullArr.byteLength;
        }
      }
    }

    if (received <= 0) {
      return { ok: false, bytes: 0, error: 'Downloaded file was empty' };
    }

    const blob = new Blob(chunks, { type: mime });
    onProgress?.(100);
    const blobUrl = URL.createObjectURL(blob);
    triggerAnchorDownload(blobUrl, safeName);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return { ok: true, bytes: blob.size };
  } catch (err) {
    return {
      ok: false,
      bytes: 0,
      error: (err as Error).message || 'Network error while downloading video',
    };
  }
}
