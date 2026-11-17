import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { DetachedPreviewWindow } from './components/DetachedPreviewWindow.tsx';
import './index.css';

const isDetachedPreview =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('window') === 'preview';

createRoot(document.getElementById('root')!).render(
  isDetachedPreview ? <DetachedPreviewWindow /> : <App />,
);
