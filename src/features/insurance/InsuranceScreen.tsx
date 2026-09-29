import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { db } from '../../db/db';
import { DOC_TYPE_LABELS } from '../../docs/docs';
import { refreshEmergencyCard } from '../../emergency/card';
import { Insurance, readInsurance, saveInsurance, type Cover } from '../../profile/insurance';
import { DocsIcon, PlusIcon } from '../../ui/icons';
import {
  Button,
  Card,
  ErrorText,
  LinkButton,
  Notice,
  PageTitle,
  RowLink,
  SectionTitle,
  SelectField,
  TextArea,
  TextField,
} from '../../ui/kit';
import { CallButton } from '../emergency/CallButton';
import { VaultGate } from '../vault/VaultGate';

const COVER_OPTIONS: { value: Cover; label: string }[] = [
  { value: 'unknown', label: 'Not checked yet' },
  { value: 'yes', label: 'Covered' },
  { value: 'no', label: 'Not covered' },
];

export function InsuranceScreen() {
  return (
    <>
      <PageTitle sub="From your policy. Encrypted on this phone.">Insurance</PageTitle>
      <VaultGate what="your insurance details">
        <InsuranceForm />
      </VaultGate>
    </>
  );
}

const numberOrNull = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

function InsuranceForm() {
  const [v, setV] = useState<Insurance | null>(null);
  const [maxDays, setMaxDays] = useState('');
  const [depth, setDepth] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const policyDocs = useLiveQuery(
    () => db.docs.where('type').anyOf('insurance-policy', 'insurance-card').toArray(),
    [],
  );

  useEffect(() => {
    void readInsurance().then((ins) => {
      setV(ins);
      setMaxDays(ins.maxDaysPerTrip?.toString() ?? '');
      setDepth(ins.divingMaxDepthM?.toString() ?? '');
    });
  }, []);

  if (!v) return null;
  const set = (patch: Partial<Insurance>) => {
    setState('idle');
    setV({ ...v, ...patch });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v) return;
    setState('saving');
    setError('');
    try {
      await saveInsurance(
        Insurance.parse({ ...v, maxDaysPerTrip: numberOrNull(maxDays), divingMaxDepthM: numberOrNull(depth) }),
      );
      await refreshEmergencyCard();
      setState('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('idle');
    }
  }

  return (
    <form onSubmit={submit}>
      {v.assistancePhone.trim() && (
        <div className="mb-4">
          <CallButton label={`${v.insurer || 'Insurer'} — 24/7 assistance`} number={v.assistancePhone} prominent />
        </div>
      )}

      <SectionTitle>Policy</SectionTitle>
      <TextField label="Insurer" value={v.insurer} onChange={(insurer) => set({ insurer })} />
      <TextField label="Policy number" value={v.policyNumber} onChange={(policyNumber) => set({ policyNumber })} />
      <TextField
        label="24/7 assistance number"
        type="tel"
        inputMode="tel"
        value={v.assistancePhone}
        onChange={(assistancePhone) => set({ assistancePhone })}
        placeholder="+31 …"
        hint="Hospitals abroad often want a payment guarantee first — this is the number that arranges it."
      />
      <TextArea label="Claim procedure" value={v.claimProcedure} onChange={(claimProcedure) => set({ claimProcedure })} />
      <TextField label="Claim deadline" value={v.claimDeadline} onChange={(claimDeadline) => set({ claimDeadline })} placeholder="e.g. within 30 days" />
      <TextField label="Excess" value={v.excess} onChange={(excess) => set({ excess })} />

      <SectionTitle>Coverage</SectionTitle>
      <TextField
        label="Maximum days per trip"
        inputMode="numeric"
        value={maxDays}
        onChange={(s) => {
          setState('idle');
          setMaxDays(s);
        }}
        hint="Policies use limits such as 45, 60, 90, 180 or 365 days."
      />
      <TextField label="Medical costs" value={v.medicalCosts} onChange={(medicalCosts) => set({ medicalCosts })} placeholder="e.g. actual costs" />
      <SelectField label="Repatriation / medical evacuation" value={v.evacuation} onChange={(evacuation) => set({ evacuation })} options={COVER_OPTIONS} />
      <TextField label="Evacuation notes" value={v.evacuationNotes} onChange={(evacuationNotes) => set({ evacuationNotes })} />
      <SelectField label="Scooter / motorbike" value={v.scooter} onChange={(scooter) => set({ scooter })} options={COVER_OPTIONS} />
      <TextField
        label="Scooter licence conditions"
        value={v.scooterConditions}
        onChange={(scooterConditions) => set({ scooterConditions })}
        placeholder="e.g. valid licence for the category + IDP"
      />
      <SelectField label="Diving" value={v.diving} onChange={(diving) => set({ diving })} options={COVER_OPTIONS} />
      <TextField
        label="Diving: maximum depth (m)"
        inputMode="decimal"
        value={depth}
        onChange={(s) => {
          setState('idle');
          setDepth(s);
        }}
      />
      <SelectField label="Trekking / adventure sports" value={v.trekking} onChange={(trekking) => set({ trekking })} options={COVER_OPTIONS} />
      <TextField label="Trekking notes" value={v.trekkingNotes} onChange={(trekkingNotes) => set({ trekkingNotes })} />
      <TextField label="Valuables limit" value={v.valuablesLimit} onChange={(valuablesLimit) => set({ valuablesLimit })} />
      <TextArea
        label="Areas with orange or red travel advice"
        value={v.orangeRedAreas}
        onChange={(orangeRedAreas) => set({ orangeRedAreas })}
        hint="What the policy says about cover there."
      />

      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" className="w-full" disabled={state === 'saving'}>
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save insurance'}
      </Button>

      <SectionTitle>Policy documents</SectionTitle>
      {policyDocs && policyDocs.length > 0 ? (
        <Card className="py-1">
          {policyDocs.map((d) => (
            <RowLink key={d.id} href={`#/docs/${d.id}`} icon={<DocsIcon />} title={DOC_TYPE_LABELS[d.type as 'insurance-policy']} />
          ))}
        </Card>
      ) : (
        <Notice title="Add the policy PDF and insurance card" action={<LinkButton href="#/docs/new"><PlusIcon size={18} /> Add document</LinkButton>}>
          Add them as documents of type “Insurance policy” or “Insurance card” and they show up here.
        </Notice>
      )}
    </form>
  );
}
