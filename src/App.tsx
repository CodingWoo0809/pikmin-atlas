import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/bits';
import { Shell } from './components/Shell';
import { appConfig } from './lib/env';
import { ConfigErrorPage, LoginPage, NotOwnerPage, SetupPasswordPage } from './pages/AuthPages';
import { CategoryEditorPage } from './pages/CategoryEditor';
import { DecoCandidatesPage, DecoHomePage } from './pages/DecoPages';
import { GalleryPage } from './pages/GalleryPage';
import { PlaceEditorPage } from './pages/PlaceEditor';
import { SettingsPage } from './pages/SettingsPage';
import { TrashPage } from './pages/TrashPage';
import { AtlasProvider } from './state/atlas';
import { AuthProvider, useAuth } from './state/auth';
import { UiProvider } from './state/ui';

// 가져오기·백업 화면은 큰 라이브러리(CSV·ZIP)를 쓰므로 필요할 때만 불러온다
const ImportPage = lazy(() => import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })));
const BackupPage = lazy(() => import('./pages/BackupPage').then((m) => ({ default: m.BackupPage })));

export default function App() {
  if (!appConfig.ok) return <ConfigErrorPage />;
  return (
    <UiProvider>
      <AuthProvider>
        <Gatekeeper />
      </AuthProvider>
    </UiProvider>
  );
}

function Gatekeeper() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <main className="gate">
        <Spinner label="확인 중" />
      </main>
    );
  }
  if (status === 'signedOut') return <LoginPage />;
  if (status === 'needsSetup') return <SetupPasswordPage />;
  if (status === 'notOwner') return <NotOwnerPage />;
  return (
    <AtlasProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/mushroom" element={<GalleryPage category="mushroom" />} />
          <Route path="/bigflower" element={<GalleryPage category="bigflower" />} />
          <Route path="/deco" element={<DecoHomePage />} />
          <Route path="/deco/:catId" element={<DecoCandidatesPage />} />
          <Route path="/place/new" element={<PlaceEditorPage />} />
          <Route path="/place/:id" element={<PlaceEditorPage />} />
          <Route path="/deco-category/new" element={<CategoryEditorPage />} />
          <Route path="/deco-category/:id" element={<CategoryEditorPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/import" element={<Suspense fallback={<Spinner />}><ImportPage /></Suspense>} />
          <Route path="/settings/backup" element={<Suspense fallback={<Spinner />}><BackupPage /></Suspense>} />
          <Route path="*" element={<Navigate to="/mushroom" replace />} />
        </Route>
      </Routes>
    </AtlasProvider>
  );
}
