import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@/index.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { AlertProvider } from '@/contexts/AlertContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { UploadProvider } from '@/contexts/UploadContext';
import AlmcApp from '@/AlmcApp';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AlertProvider>
          <ConfirmProvider>
            <UploadProvider>
              <AlmcApp />
            </UploadProvider>
          </ConfirmProvider>
        </AlertProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
