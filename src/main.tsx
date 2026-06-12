import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global error listener for JSON SyntaxErrors
window.addEventListener('error', (event) => {
  if (event.error instanceof SyntaxError && event.error.message.includes('JSON')) {
    console.group('🚨 UNCAUGHT JSON ERROR DETECTED');
    console.error('Message:', event.error.message);
    console.error('Stack:', event.error.stack);
    console.groupEnd();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
