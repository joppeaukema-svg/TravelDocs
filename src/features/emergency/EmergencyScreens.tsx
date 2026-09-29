import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { allCountries, getCountry, globalContent } from '../../content';
import { db, META } from '../../db/db';
import {
  CARD_FIELD_LABELS,
  CardChoices,
  parseCard,
  readCardChoices,
  refreshEmergencyCard,
} from '../../emergency/card';
import { useCurrentCountry } from '../../rules/useRules';
import { EditIcon, ExternalIcon } from '../../ui/icons';
import { Button, Card, cx, LinkButton, Notice, PageTitle, SectionTitle, Toggle } from '../../ui/kit';
import { VaultGate } from '../vault/VaultGate';
import { CallButton } from './CallButton';

function Detail({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <p className="text-sm font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

export function EmergencyScreen() {
  const current = useCurrentCountry();
  const [picked, setPicked] = useState<string | null>(null);
  const code = picked ?? current.code;
  const country = getCountry(code);
  const card = parseCard(useLiveQuery(() => db.meta.get(META.emergencyCard), [])?.value);
  const bz = globalContent().emergencyNumbers;
  const medical = [card.bloodType, card.allergies, card.medication, card.medicalNotes].some(Boolean);

  return (
    <>
      <PageTitle sub="Works offline and while the vault is locked.">Emergency</PageTitle>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Country">
        {allCountries().map((c) => (
          <button
            key={c.country}
            type="button"
            role="tab"
            aria-selected={c.country === code}
            onClick={() => setPicked(c.country)}
            className={cx(
              'min-h-11 shrink-0 rounded-full border px-4 font-bold',
              c.country === code ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {country ? (
        <>
          <SectionTitle>Local emergency · {country.name}</SectionTitle>
          <div className="space-y-2">
            {country.emergencyNumbers.map((n, i) => (
              <CallButton
                key={n.id}
                label={n.label}
                number={n.number}
                note={n.note}
                unverified={n.unverified}
                prominent={i === 0}
              />
            ))}
          </div>
          {country.emergencyNote && <p className="mt-2 text-muted">{country.emergencyNote}</p>}
        </>
      ) : (
        <Notice title="Pick a country above">Its emergency numbers appear here.</Notice>
      )}

      <SectionTitle>Dutch government, 24/7</SectionTitle>
      <div className="space-y-2">
        {bz.map((n) => (
          <CallButton key={n.id} label={n.label} number={n.number} kind={n.kind} />
        ))}
      </div>
      {country && (
        <LinkButton href={country.adviceUrl} external variant="ghost" className="mt-1 w-full">
          Dutch embassy details in the travel advice <ExternalIcon size={18} />
        </LinkButton>
      )}

      {(card.insurer || card.assistancePhone || card.policyNumber) && (
        <>
          <SectionTitle>Travel insurance</SectionTitle>
          {card.assistancePhone && (
            <CallButton label={`${card.insurer ?? 'Insurer'} — 24/7 assistance`} number={card.assistancePhone} />
          )}
          <Card className="mt-2 py-1">
            <Detail label="Insurer" value={card.insurer} />
            <Detail label="Policy number" value={card.policyNumber} />
          </Card>
        </>
      )}

      {card.iceContacts && card.iceContacts.length > 0 && (
        <>
          <SectionTitle>In case of emergency (ICE)</SectionTitle>
          <div className="space-y-2">
            {card.iceContacts.map((c, i) => (
              <CallButton key={i} label={c.relation ? `${c.name} (${c.relation})` : c.name} number={c.phone} />
            ))}
          </div>
        </>
      )}

      {(medical || card.fullName) && (
        <>
          <SectionTitle>Medical</SectionTitle>
          <Card className="py-1">
            <Detail label="Name" value={card.fullName} />
            <Detail label="Blood type" value={card.bloodType} />
            <Detail label="Allergies" value={card.allergies} />
            <Detail label="Medication" value={card.medication} />
            <Detail label="Notes" value={card.medicalNotes} />
          </Card>
        </>
      )}

      <LinkButton href="#/emergency/edit" className="mt-6 w-full">
        <EditIcon size={18} /> Choose what's on this card
      </LinkButton>
    </>
  );
}

export function EmergencyEditScreen() {
  return (
    <>
      <PageTitle sub="Chosen fields are stored unencrypted so the card works while the vault is locked.">
        Emergency card
      </PageTitle>
      <VaultGate what="your emergency card settings">
        <CardChoicesForm />
      </VaultGate>
    </>
  );
}

function CardChoicesForm() {
  const [choices, setChoices] = useState<CardChoices | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void readCardChoices().then(setChoices);
  }, []);

  if (!choices) return null;
  const keys = Object.keys(CARD_FIELD_LABELS) as (keyof CardChoices)[];

  async function save() {
    await refreshEmergencyCard(CardChoices.parse(choices));
    setSaved(true);
  }

  return (
    <>
      <Card className="py-1">
        {keys.map((k) => (
          <Toggle
            key={k}
            label={CARD_FIELD_LABELS[k]}
            checked={choices[k]}
            onChange={(v) => {
              setSaved(false);
              setChoices({ ...choices, [k]: v });
            }}
          />
        ))}
      </Card>
      <p className="mt-3 text-muted">
        The values come from <a href="#/insurance">Insurance</a> and <a href="#/personal">Personal details</a>, and
        the card updates whenever you save those.
      </p>
      <Button variant="primary" className="mt-4 w-full" onClick={() => void save()}>
        Save card
      </Button>
      {saved && (
        <div className="mt-3">
          <Notice tone="ok" title="Emergency card updated" action={<LinkButton href="#/emergency">View card</LinkButton>} />
        </div>
      )}
    </>
  );
}
