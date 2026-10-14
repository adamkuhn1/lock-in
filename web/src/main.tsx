import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import type { DataApi } from './data/api';
import type { AuthApi } from './data/auth';
import './styles/tokens.css';
import './styles/app.css';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    let api: DataApi;
    let auth: AuthApi;
    if (import.meta.env.VITE_DEMO === '1') {
      const demo = await import('./data/demo');
      api = demo.createDemoApi();
      auth = demo.demoAuth;
    } else {
      const [{ createSupabase, createSupabaseApi }, { supabaseAuth }] = await Promise.all([import('./data/supabase'), import('./data/auth')]);
      const sb = createSupabase();
      api = createSupabaseApi(sb);
      auth = supabaseAuth(sb);
    }
    root.render(<StrictMode><App api={api} auth={auth} /></StrictMode>);
  } catch (e) {
    root.render(<p role="alert" className="error boot-error">{e instanceof Error ? e.message : String(e)}</p>);
  }
}

void boot();
