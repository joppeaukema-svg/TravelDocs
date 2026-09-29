import { useEffect, useState, type FormEvent } from 'react';
import { refreshEmergencyCard } from '../../emergency/card';
import { Personal, readPersonal, savePersonal, type IceContact } from '../../profile/personal';
import { PlusIcon, TrashIcon } from '../../ui/icons';
import { Button, Card, ErrorText, PageTitle, SectionTitle, TextArea, TextField } from '../../ui/kit';
import { VaultGate } from '../vault/VaultGate';

export function PersonalScreen() {
  return (
    <>
      <PageTitle sub="Encrypted on this phone. You choose what appears on the emergency card.">
        Personal details
      </PageTitle>
      <VaultGate what="your personal details">
        <PersonalForm />
      </VaultGate>
    </>
  );
}

function PersonalForm() {
  const [v, setV] = useState<Personal | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    void readPersonal().then(setV);
  }, []);
  if (!v) return null;

  const set = (patch: Partial<Personal>) => {
    setState('idle');
    setV({ ...v, ...patch });
  };
  const setContact = (i: number, patch: Partial<IceContact>) =>
    set({ iceContacts: v.iceContacts.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v) return;
    setState('saving');
    setError('');
    try {
      await savePersonal({ ...v, iceContacts: v.iceContacts.filter((c) => c.name.trim() || c.phone.trim()) });
      await refreshEmergencyCard();
      setState('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('idle');
    }
  }

  return (
    <form onSubmit={submit}>
      <SectionTitle>About me</SectionTitle>
      <TextField label="Full name (as in passport)" value={v.fullName} onChange={(fullName) => set({ fullName })} autoComplete="name" />
      <TextField label="Date of birth" type="date" value={v.dateOfBirth} onChange={(dateOfBirth) => set({ dateOfBirth })} />
      <TextField label="Nationality" value={v.nationality} onChange={(nationality) => set({ nationality })} placeholder="Dutch" />

      <SectionTitle>In case of emergency</SectionTitle>
      {v.iceContacts.map((c, i) => (
        <Card key={i} className="mb-3">
          <TextField label="Name" value={c.name} onChange={(name) => setContact(i, { name })} />
          <TextField label="Relation" value={c.relation} onChange={(relation) => setContact(i, { relation })} placeholder="e.g. partner" />
          <TextField label="Phone" type="tel" inputMode="tel" value={c.phone} onChange={(phone) => setContact(i, { phone })} placeholder="+31 6 …" />
          <Button variant="ghost" className="text-crit" onClick={() => set({ iceContacts: v.iceContacts.filter((_, j) => j !== i) })}>
            <TrashIcon size={18} /> Remove contact
          </Button>
        </Card>
      ))}
      <Button className="w-full" onClick={() => set({ iceContacts: [...v.iceContacts, { name: '', relation: '', phone: '' }] })}>
        <PlusIcon /> Add ICE contact
      </Button>

      <SectionTitle>Medical</SectionTitle>
      <TextField label="Blood type" value={v.bloodType} onChange={(bloodType) => set({ bloodType })} placeholder="e.g. O+" />
      <TextArea label="Allergies" value={v.allergies} onChange={(allergies) => set({ allergies })} />
      <TextArea label="Medication" value={v.medication} onChange={(medication) => set({ medication })} />
      <TextArea label="Other medical notes" value={v.medicalNotes} onChange={(medicalNotes) => set({ medicalNotes })} />

      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" className="mt-2 w-full" disabled={state === 'saving'}>
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save details'}
      </Button>
      <p className="mt-3 text-muted">
        Next: <a href="#/emergency/edit">choose what appears on the emergency card</a>.
      </p>
    </form>
  );
}
