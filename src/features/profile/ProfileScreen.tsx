import { useState } from 'react';
import { formatDate } from '../../lib/format';
import { FLAG_LABELS, parseProfile, updateProfile, usePassportExpiry, useProfileRaw } from '../../profile/profile';
import { ProfileFlag } from '../../rules/content';
import { Card, PageTitle, SectionTitle, TextField, Toggle } from '../../ui/kit';

export function ProfileScreen() {
  const raw = useProfileRaw();
  const { profile } = parseProfile(raw);
  const fromDocs = usePassportExpiry(undefined);
  const [pages, setPages] = useState<string | null>(null);

  return (
    <>
      <PageTitle sub="Used by the entry checks. Stored on this phone without names or numbers.">Profile and bag</PageTitle>

      <SectionTitle>Passport</SectionTitle>
      <Card>
        {fromDocs ? (
          <p>
            Expires <strong>{formatDate(fromDocs)}</strong> <span className="text-muted">(from your passport document)</span>
          </p>
        ) : (
          <TextField
            label="Passport expiry date"
            type="date"
            value={profile.passportExpiry ?? ''}
            onChange={(v) => void updateProfile({ passportExpiry: v || undefined })}
            hint="Or add your passport under Docs with its expiry date."
          />
        )}
        <TextField
          label="Blank pages left"
          inputMode="numeric"
          value={pages ?? profile.blankPages?.toString() ?? ''}
          onChange={(v) => {
            setPages(v);
            const n = Number(v);
            if (v === '') void updateProfile({ blankPages: undefined });
            else if (Number.isInteger(n) && n >= 0) void updateProfile({ blankPages: n });
          }}
        />
      </Card>

      <SectionTitle>In my bag / on my plans</SectionTitle>
      <Card className="py-1">
        {ProfileFlag.options.map((flag) => (
          <Toggle
            key={flag}
            label={FLAG_LABELS[flag].label}
            hint={FLAG_LABELS[flag].hint}
            checked={!!profile.flags[flag]}
            onChange={(on) => void updateProfile({ flags: { ...profile.flags, [flag]: on } })}
          />
        ))}
      </Card>
    </>
  );
}
