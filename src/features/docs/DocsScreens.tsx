import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { db, type DocIndexRow } from '../../db/db';
import {
  addDocumentFiles,
  createDocument,
  deleteDocument,
  DOC_TYPE_LABELS,
  DocType,
  readDocument,
  removeDocumentFile,
  updateDocument,
  DocSecret,
} from '../../docs/docs';
import { prepareFile } from '../../docs/images';
import { daysBetween, formatDate, plural, todayIn } from '../../lib/format';
import { go } from '../../app/hooks';
import { DocsIcon, PlusIcon, TrashIcon } from '../../ui/icons';
import {
  Button,
  Card,
  ErrorText,
  LinkButton,
  Notice,
  PageTitle,
  Pill,
  RowLink,
  SectionTitle,
  SelectField,
  TextArea,
  TextField,
} from '../../ui/kit';
import { getSecret } from '../../vault/vault';
import { VaultGate } from '../vault/VaultGate';
import { AddFileButtons, FileTile, FileViewer } from './files';

const TYPE_OPTIONS = DocType.options.map((value) => ({ value, label: DOC_TYPE_LABELS[value] }));

/** Expiry as a pill: expired, soon, or just the date. */
export function ExpiryPill({ expiresAt }: { expiresAt?: string | undefined }) {
  if (!expiresAt) return null;
  const days = daysBetween(todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone), expiresAt);
  if (days < 0) return <Pill tone="crit">Expired</Pill>;
  if (days <= 90) return <Pill tone="warn">Expires in {plural(days, 'day')}</Pill>;
  return <Pill tone="muted">Until {formatDate(expiresAt)}</Pill>;
}

export function DocsScreen() {
  return (
    <>
      <PageTitle sub="Encrypted on this phone.">Documents</PageTitle>
      <VaultGate what="your documents">
        <DocsList />
      </VaultGate>
    </>
  );
}

function useDocTitles(docs: DocIndexRow[] | undefined): Record<string, string> {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const key = docs?.map((d) => d.id + d.updatedAt).join() ?? '';
  useEffect(() => {
    if (!docs) return;
    let cancelled = false;
    void Promise.all(docs.map(async (d) => [d.id, (await getSecret(`doc:${d.id}`, DocSecret))?.title ?? ''] as const)).then(
      (pairs) => !cancelled && setTitles(Object.fromEntries(pairs)),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the docs that matter
  }, [key]);
  return titles;
}

function DocsList() {
  const docs = useLiveQuery(() => db.docs.orderBy('type').toArray(), []);
  const titles = useDocTitles(docs);
  if (!docs) return null;

  return (
    <>
      <LinkButton href="#/docs/new" variant="primary" className="w-full">
        <PlusIcon /> Add document
      </LinkButton>
      {docs.length === 0 ? (
        <Card className="mt-4">
          <p className="font-bold">Nothing here yet</p>
          <p className="mt-1 text-muted">
            Start with your passport: take a photo of the photo page. Then add visas, insurance papers, your driving
            permit and tickets.
          </p>
        </Card>
      ) : (
        DocType.options
          .filter((t) => docs.some((d) => d.type === t))
          .map((t) => (
            <div key={t}>
              <SectionTitle>{DOC_TYPE_LABELS[t]}</SectionTitle>
              <Card className="py-1">
                {docs
                  .filter((d) => d.type === t)
                  .map((d) => (
                    <RowLink
                      key={d.id}
                      href={`#/docs/${d.id}`}
                      icon={<DocsIcon />}
                      title={titles[d.id] || DOC_TYPE_LABELS[t]}
                      sub={plural(d.fileIds.length, 'file')}
                      trailing={<ExpiryPill expiresAt={d.expiresAt} />}
                    />
                  ))}
              </Card>
            </div>
          ))
      )}
    </>
  );
}

export function NewDocScreen() {
  return (
    <>
      <PageTitle>New document</PageTitle>
      <VaultGate what="your documents">
        <DocForm
          initial={{ type: 'passport', expiresAt: '', secret: { title: '', number: '', issuer: '', issuedAt: '', notes: '' } }}
          submitLabel="Save and add files"
          onSubmit={async (v) => {
            const id = await createDocument(v);
            go(`/docs/${id}`);
          }}
        />
      </VaultGate>
    </>
  );
}

export function DocScreen({ id }: { id: string }) {
  return (
    <VaultGate what="this document">
      <DocDetail key={id} id={id} />
    </VaultGate>
  );
}

interface FormValue {
  type: DocType;
  expiresAt: string;
  secret: DocSecret;
}

function DocForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: FormValue;
  submitLabel: string;
  onSubmit: (v: FormValue) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const setSecret = (patch: Partial<DocSecret>) => {
    setSaved(false);
    setV({ ...v, secret: { ...v.secret, ...patch } });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ ...v, secret: { ...v.secret, title: v.secret.title.trim() || DOC_TYPE_LABELS[v.type] } });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <SelectField label="Type" value={v.type} onChange={(type) => setV({ ...v, type })} options={TYPE_OPTIONS} />
      <TextField label="Title" value={v.secret.title} onChange={(title) => setSecret({ title })} placeholder={DOC_TYPE_LABELS[v.type]} />
      <TextField label="Document number" value={v.secret.number} onChange={(number) => setSecret({ number })} />
      <TextField
        label="Expiry date"
        type="date"
        value={v.expiresAt}
        onChange={(expiresAt) => {
          setSaved(false);
          setV({ ...v, expiresAt });
        }}
        hint="Stored unencrypted so expiry warnings work while the vault is locked."
      />
      <TextField label="Issued by" value={v.secret.issuer} onChange={(issuer) => setSecret({ issuer })} />
      <TextField label="Issue date" type="date" value={v.secret.issuedAt} onChange={(issuedAt) => setSecret({ issuedAt })} />
      <TextArea label="Notes" value={v.secret.notes} onChange={(notes) => setSecret({ notes })} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? 'Saving…' : saved ? 'Saved' : submitLabel}
      </Button>
    </form>
  );
}

function DocDetail({ id }: { id: string }) {
  // null = not found; undefined = still loading.
  const index = useLiveQuery(async () => (await db.docs.get(id)) ?? null, [id]);
  const [initial, setInitial] = useState<FormValue | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void readDocument(id).then(
      (d) => d && setInitial({ type: DocType.catch('other').parse(d.index.type), expiresAt: d.index.expiresAt ?? '', secret: d.secret }),
    );
  }, [id]);

  if (index === undefined) return null;
  if (index === null) {
    return (
      <Notice tone="warn" title="This document no longer exists" action={<LinkButton href="#/docs">All documents</LinkButton>} />
    );
  }

  async function addFiles(files: File[]) {
    setAdding(true);
    setError('');
    try {
      const prepared = await Promise.all(files.map(prepareFile));
      await addDocumentFiles(id, prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function removeDoc() {
    if (!window.confirm('Delete this document and all its files?')) return;
    await deleteDocument(id);
    go('/docs');
  }

  return (
    <>
      <PageTitle sub={DOC_TYPE_LABELS[DocType.catch('other').parse(index.type)]}>{initial?.secret.title || 'Document'}</PageTitle>

      <SectionTitle>Files</SectionTitle>
      {index.fileIds.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {index.fileIds.map((fid) => (
            <FileTile key={fid} fileId={fid} onOpen={() => setViewing(fid)} />
          ))}
        </div>
      )}
      <AddFileButtons onFiles={(f) => void addFiles(f)} disabled={adding} />
      {adding && <p className="mt-2 text-muted">Encrypting…</p>}
      <ErrorText>{error}</ErrorText>
      <p className="mt-2 text-sm text-muted">Photos are scaled to 2000 px and their location data removed.</p>

      <SectionTitle>Details</SectionTitle>
      {initial && (
        <DocForm
          key={id}
          initial={initial}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await updateDocument(id, v);
            setInitial(v);
          }}
        />
      )}

      <Button variant="danger" className="mt-8 w-full" onClick={() => void removeDoc()}>
        <TrashIcon size={20} /> Delete document
      </Button>

      {viewing && (
        <FileViewer
          fileId={viewing}
          onClose={() => setViewing(null)}
          onDelete={async () => {
            if (!window.confirm('Delete this file?')) return;
            await removeDocumentFile(id, viewing);
            setViewing(null);
          }}
        />
      )}
    </>
  );
}
