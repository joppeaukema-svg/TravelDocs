import { useState } from 'react';
import type { ImportResult } from '../../trip/io';
import { deleteTrip, useTrip } from '../../trip/store';
import { DownloadIcon } from '../../ui/icons';
import { Button, Card, PageTitle, SectionTitle } from '../../ui/kit';
import { SharePanel } from '../trip/SharePanel';
import { SyncPanel } from './SyncPanel';
import { exportTrip, ImportPanel, ImportReport } from '../trip/TripScreen';

/** Everything exchanged with a travel companion or as a file: link, send, receive, import, export. */
export function TogetherScreen() {
  const trip = useTrip();
  const [report, setReport] = useState<ImportResult | null>(null);
  if (trip === undefined) return null;

  return (
    <>
      <PageTitle sub="Share the trip with your travel companion, and import or export trip files.">Travelling together</PageTitle>
      {report && (
        <div className="mb-3">
          <ImportReport result={report} onClose={() => setReport(null)} />
        </div>
      )}
      <SyncPanel />
      <div className="mt-4">
        <SharePanel hasTrip={!!trip} />
      </div>

      <SectionTitle>Trip files</SectionTitle>
      <ImportPanel replacing={!!trip} onImported={setReport} />
      {trip && (
        <Card className="mt-3">
          <Button className="w-full" onClick={() => void exportTrip(trip)}>
            <DownloadIcon /> Save the trip as a file (my-trip.json)
          </Button>
          <p className="mt-2 text-sm text-muted">A copy of the whole itinerary, to keep or to import on another phone.</p>
          <Button
            variant="ghost"
            className="mt-2 w-full text-crit"
            onClick={async () => {
              if (window.confirm('Delete the trip from this phone? Documents stay.')) await deleteTrip();
            }}
          >
            Delete trip
          </Button>
        </Card>
      )}
    </>
  );
}
