import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
import '@fontsource/atkinson-hyperlegible-next/latin-ext-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-ext-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { seedDemoOnce } from './demo/demo';

// In demo mode the sample data is written before the first screen shows.
void seedDemoOnce()
  .catch((err: unknown) => console.error('Demo data could not be set up', err))
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
