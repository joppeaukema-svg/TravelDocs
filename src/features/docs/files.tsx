import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isPdf } from '../../docs/images';
import { formatBytes } from '../../lib/format';
import { shareFile } from '../../lib/share';
import { beginExternalPick, endExternalPick } from '../../vault/autoLock';
import { vaultSession } from '../../vault/session';
import { getFile } from '../../vault/vault';
import { CameraIcon, CloseIcon, FileIcon, ImageIcon, ShareIcon, TrashIcon } from '../../ui/icons';
import { Button } from '../../ui/kit';

export interface DecryptedFile {
  url: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
}

/** Decrypts a vault file into an object URL; revoked on unmount and when the vault locks. */
export function useDecryptedFile(fileId: string): DecryptedFile | null {
  const [file, setFile] = useState<DecryptedFile | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const release = () => {
      if (url) URL.revokeObjectURL(url);
      url = null;
      setFile(null);
    };
    void getFile(fileId).then((f) => {
      if (cancelled || !f) return;
      const blob = new Blob([f.bytes], { type: f.type });
      url = URL.createObjectURL(blob);
      setFile({ url, name: f.name, type: f.type, size: f.bytes.length, blob });
    });
    const off = vaultSession.onLock(release);
    return () => {
      cancelled = true;
      off();
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);
  return file;
}

export function FileTile({ fileId, onOpen }: { fileId: string; onOpen: () => void }) {
  const file = useDecryptedFile(fileId);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!file}
      className="flex aspect-square w-full flex-col overflow-hidden rounded-xl border border-line bg-sunk text-left"
      aria-label={file ? `Open ${file.name}` : 'Decrypting…'}
    >
      {file && !isPdf(file.type) ? (
        <img src={file.url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-muted">
          <FileIcon size={32} />
          <span className="line-clamp-2 break-all text-center text-xs">{file?.name ?? '…'}</span>
        </span>
      )}
    </button>
  );
}

/** Full screen on white — for QR codes, tickets and showing a document at a counter. */
export function FileViewer({
  fileId,
  onClose,
  onDelete,
}: {
  fileId: string;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const file = useDecryptedFile(fileId);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={file?.name ?? 'Document'} className="fixed inset-0 z-50 flex flex-col bg-white text-[#16213a]">
      <div className="safe-top flex items-center gap-2 border-b border-black/10 px-3 pb-2">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="grid h-12 w-12 place-items-center rounded-full active:bg-black/5"
          aria-label="Close"
        >
          <CloseIcon size={28} />
        </button>
        <p className="min-w-0 flex-1 truncate font-bold">
          {file?.name}
          {file && <span className="ml-2 font-normal text-[#555e70]">{formatBytes(file.size)}</span>}
        </p>
        {file && (
          <button
            type="button"
            className="grid h-12 w-12 place-items-center rounded-full active:bg-black/5"
            aria-label="Share or save"
            onClick={() => void shareFile(file.blob, file.name)}
          >
            <ShareIcon />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="grid h-12 w-12 place-items-center rounded-full text-[#a8201a] active:bg-black/5"
            aria-label="Delete file"
            onClick={onDelete}
          >
            <TrashIcon />
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {!file && <p>Decrypting…</p>}
        {file && !isPdf(file.type) && <img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" />}
        {file && isPdf(file.type) && (
          <div className="flex h-full w-full flex-col gap-3">
            <iframe src={file.url} title={file.name} className="min-h-0 w-full flex-1 rounded-lg border border-black/10" />
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-12 items-center justify-center rounded-xl border border-black/15 font-bold text-[#16213a] no-underline"
            >
              Open PDF in the viewer
            </a>
            <p className="text-center text-sm text-[#555e70]">For a boarding pass, add a screenshot of the QR code for a sharp full-screen view.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PickButton({
  accept,
  capture,
  multiple,
  onFiles,
  children,
}: {
  accept: string;
  capture?: 'environment';
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.addEventListener('cancel', endExternalPick);
    return () => el?.removeEventListener('cancel', endExternalPick);
  }, []);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        multiple={multiple}
        hidden
        onChange={(e) => {
          endExternalPick();
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <Button
        className="flex-1 flex-col gap-0.5 px-2 text-sm"
        onClick={() => {
          beginExternalPick();
          ref.current?.click();
        }}
      >
        {children}
      </Button>
    </>
  );
}

export function AddFileButtons({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  return (
    <div className={disabled ? 'pointer-events-none flex gap-2 opacity-50' : 'flex gap-2'}>
      <PickButton accept="image/*" capture="environment" onFiles={onFiles}>
        <CameraIcon /> Camera
      </PickButton>
      <PickButton accept="image/*" multiple onFiles={onFiles}>
        <ImageIcon /> Photos
      </PickButton>
      <PickButton accept="image/*,application/pdf,.pdf" multiple onFiles={onFiles}>
        <FileIcon /> Files
      </PickButton>
    </div>
  );
}

