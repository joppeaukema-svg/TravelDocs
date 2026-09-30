import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getCountry, phrasebook } from '../../content';
import type { PhraseLang, PhrasesFile } from '../../content/schema';
import { getMeta, setMeta } from '../../db/db';
import { useCurrentCountry, useToday } from '../../rules/useRules';
import { useTrip } from '../../trip/store';
import { accommodationOn } from '../../trip/timeline';
import { CloseIcon, SpeechIcon } from '../../ui/icons';
import { Button, Card, cx, inputClass, Notice, PageTitle, RowLink, SectionTitle } from '../../ui/kit';
import { speak, useVoice } from './speech';

const book = () => phrasebook();

function SpeakButton({ text, lang }: { text: string; lang: string }) {
  const voice = useVoice(lang);
  if (!voice) return null;
  return (
    <button
      type="button"
      onClick={() => speak(text, voice)}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-accent active:bg-sunk"
      aria-label={`Say it aloud`}
    >
      <SpeechIcon size={20} />
    </button>
  );
}

export function PhraseList({ lang }: { lang: PhraseLang }) {
  const info = book().languages[lang];
  const voice = useVoice(info.speech);
  return (
    <>
      {info.note && <p className="mb-2 text-muted">{info.note}</p>}
      <Card className="py-1">
        <ul>
          {book().phrases.map((p) => {
            const t = p.t[lang];
            return (
              <li key={p.id} className="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted">{p.en}</p>
                  <p className="text-xl font-bold" lang={info.speech}>
                    {t.text}
                  </p>
                  {t.roman && <p className="text-sm italic">{t.roman}</p>}
                </div>
                <SpeakButton text={t.text} lang={info.speech} />
              </li>
            );
          })}
        </ul>
      </Card>
      <p className="mt-2 text-sm text-muted">
        {voice ? 'Tap the speaker to hear it.' : 'This phone has no voice for this language, so there is no read-aloud.'} Not checked by a
        native speaker.
      </p>
    </>
  );
}

/** Full-screen, high-contrast text to show someone. */
function ShowCard({ local, english, lang, onClose }: { local: string; english: string; lang: string; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Show this" className="fixed inset-0 z-50 flex flex-col bg-white p-6 text-black">
      <button type="button" onClick={onClose} className="ml-auto grid h-12 w-12 place-items-center rounded-full bg-black/5" aria-label="Close">
        <CloseIcon />
      </button>
      <div className="flex flex-1 flex-col justify-center">
        <p className="whitespace-pre-line text-4xl font-bold leading-snug" lang={lang}>
          {local}
        </p>
        <p className="mt-6 whitespace-pre-line text-xl text-black/70">{english}</p>
      </div>
    </div>
  );
}

const ADDRESS_KEY = 'showCardAddress';

export function ShowCards({ lang }: { lang: PhraseLang }) {
  const info = book().languages[lang];
  const trip = useTrip();
  const today = useToday();
  const bed = trip ? accommodationOn(trip, today) : undefined;
  const saved = useLiveQuery(async () => ((await getMeta(ADDRESS_KEY)) as string | undefined) ?? '', []);
  const [draft, setDraft] = useState<string | null>(null);
  const [allergen, setAllergen] = useState(book().allergens[0]!.id);
  const [shown, setShown] = useState<{ local: string; english: string } | null>(null);
  const card = (id: string) => book().cards.find((c) => c.id === id)!;
  const address = draft ?? (saved || bed?.addressLocal || bed?.address || '');

  const tile = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="min-h-20 rounded-2xl border border-line bg-card p-3 text-left font-bold active:scale-[0.99]">
      {label}
    </button>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {tile('Use the meter', () => setShown({ local: card('meter').t[lang], english: card('meter').en }))}
        {tile('Where is the hospital?', () => setShown({ local: card('hospital').t[lang], english: card('hospital').en }))}
      </div>

      <SectionTitle>Take me to this address</SectionTitle>
      <Card>
        <label className="font-bold" htmlFor="show-address">
          Address {bed?.addressLocal ? '(from your booking)' : 'in the local script'}
        </label>
        <textarea
          id="show-address"
          rows={3}
          className={cx(inputClass, 'mt-1')}
          value={address}
          lang={info.speech}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== null && void setMeta(ADDRESS_KEY, draft)}
          placeholder="Copy the address from your booking, ideally in the local script"
        />
        <Button
          variant="primary"
          className="mt-2 w-full"
          disabled={!address.trim()}
          onClick={() => setShown({ local: `${card('take-me').t[lang]}\n\n${address}`, english: card('take-me').en })}
        >
          Show address
        </Button>
      </Card>

      <SectionTitle>Allergy</SectionTitle>
      <Card>
        <div className="flex flex-wrap gap-2">
          {book().allergens.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAllergen(a.id)}
              className={cx('min-h-11 rounded-full border px-4 font-bold', a.id === allergen ? 'border-ink bg-ink text-paper' : 'border-line bg-card')}
            >
              {a.en}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          className="mt-3 w-full"
          onClick={() => {
            const a = book().allergens.find((x) => x.id === allergen)!;
            setShown({ local: card('allergic').t[lang].replace('{item}', a.t[lang]), english: card('allergic').en.replace('{item}', a.en) });
          }}
        >
          Show allergy card
        </Button>
      </Card>
      <p className="mt-2 text-sm text-muted">{book().note}</p>
      {shown && <ShowCard {...shown} lang={info.speech} onClose={() => setShown(null)} />}
    </>
  );
}

export function PhrasesScreen() {
  const here = useCurrentCountry().code;
  const langs = Object.entries(book().languages) as [PhraseLang, PhrasesFile['languages'][PhraseLang]][];
  const sorted = [...langs].sort(([, a], [, b]) => Number(b.countries.includes(here ?? '')) - Number(a.countries.includes(here ?? '')));
  return (
    <>
      <PageTitle sub="Key phrases and big cards to show people.">Phrases</PageTitle>
      <Card className="py-1">
        {sorted.map(([code, l]) => (
          <RowLink
            key={code}
            href={`#/phrases/${code}`}
            icon={<SpeechIcon />}
            title={l.name}
            sub={l.countries.map((c) => getCountry(c)?.name ?? c).join(', ')}
          />
        ))}
      </Card>
    </>
  );
}

export function LanguageScreen({ lang }: { lang: string }) {
  const info = book().languages[lang as PhraseLang];
  if (!info) return <Notice tone="warn" title="Unknown language" />;
  return (
    <>
      <PageTitle sub={info.countries.map((c) => getCountry(c)?.name ?? c).join(', ')}>{info.name}</PageTitle>
      <SectionTitle>Show this</SectionTitle>
      <ShowCards lang={lang as PhraseLang} />
      <SectionTitle>Phrases</SectionTitle>
      <PhraseList lang={lang as PhraseLang} />
    </>
  );
}
