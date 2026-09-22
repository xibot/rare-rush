import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import '../style.css';
import './shell.css';
import '../navbar.css';
createRoot(document.getElementById('app')!).render(<App/>);
