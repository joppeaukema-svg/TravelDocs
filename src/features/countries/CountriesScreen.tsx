import { allCountries, getCountry } from '../../content';
import { useNow } from '../../app/hooks';
import { clock } from '../../lib/format';
import { updateSettings } from '../../settings/settings';
import { useCurrentCountry } from '../../rules/useRules';
import { ExternalIcon } from '../../ui/icons';
import { Button, Card, LinkButton, Notice, PageTitle, Pill, RowLink, SectionTitle } from '../../ui/kit';
import { CallButton } from '../emergency/CallButton';

export function CountriesScreen() {
  const now = useNow();
  const countryOverride = useCurrentCountry().code;
  return (
    <>
      <PageTitle sub="Full guides with sources arrive in phase 3.">Countries</PageTitle>
      <Card className="py-1">
        {allCountries().map((c) => (
          <RowLink
            key={c.country}
            href={`#/countries/${c.country}`}
            icon={<span className="font-mono text-sm font-medium">{c.country}</span>}
            title={c.name}
            sub={`${clock(c.timeZone, now).time} local · ${c.currency}`}
            trailing={c.country === countryOverride ? <Pill tone="ok">Here now</Pill> : undefined}
          />
        ))}
      </Card>
    </>
  );
}

export function CountryScreen({ code }: { code: string }) {
  const country = getCountry(code.toUpperCase());
  const now = useNow();
  const countryOverride = useCurrentCountry().code;
  if (!country) return <Notice tone="warn" title="Unknown country" />;
  const local = clock(country.timeZone, now);

  return (
    <>
      <PageTitle sub={`${local.day}, ${local.time} local time · ${country.currency}`}>{country.name}</PageTitle>
      {country.country !== countryOverride && (
        <Button className="w-full" onClick={() => void updateSettings({ countryOverride: country.country })}>
          I'm in {country.name} now
        </Button>
      )}

      <SectionTitle>Emergency numbers</SectionTitle>
      <div className="space-y-2">
        {country.emergencyNumbers.map((n) => (
          <CallButton key={n.id} label={n.label} number={n.number} note={n.note} unverified={n.unverified} />
        ))}
      </div>
      {country.emergencyNote && <p className="mt-2 text-muted">{country.emergencyNote}</p>}

      <SectionTitle>Dutch travel advice</SectionTitle>
      <Card>
        <p>The live advice, its colour code and the Dutch embassy details sync into the app in phase 3. Until then:</p>
        <LinkButton href={country.adviceUrl} external className="mt-3 w-full">
          Open the advice (online) <ExternalIcon size={18} />
        </LinkButton>
      </Card>
    </>
  );
}
