import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.tsx';
import { getDeviceId } from './db/deviceId';

getDeviceId();

registerSW({
  onOfflineReady() {
    console.info('[PWA] App shell cached — ready for offline use.');
  },
  onRegisteredSW() {
    console.info('[PWA] Service worker registered.');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
