import { beginExternalPick, endExternalPick } from '../vault/autoLock';

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet (Save to Files, Drive, mail…) where supported,
 * otherwise downloads. The share sheet backgrounds the app on phones, so the
 * vault's background lock is held off meanwhile.
 */
export async function shareFile(blob: Blob, name: string, mode: 'share' | 'download' = 'share'): Promise<ShareResult> {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (mode === 'share' && navigator.canShare?.({ files: [file] })) {
    beginExternalPick();
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // NotAllowedError: the browser refused the share sheet (e.g. iOS when too much time passed
      // since the tap). Saving the file still works, so fall back to a download.
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) throw err;
    } finally {
      endExternalPick();
    }
  }
  download(file);
  return 'downloaded';
}
