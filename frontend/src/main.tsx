import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
