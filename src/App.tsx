import { useState } from 'react';
import './App.css';
import PlayLab from './pages/PlayLab.tsx';
import SampleDB from './pages/SampleDB.tsx';
import { APP_VERSION } from './version.tsx';

type Page = 'play' | 'sample';

export default function App() {
  const [page, setPage] = useState('play' as Page);

  return (
    <div className="app">
      <header className="topbar">
        SQL PlayLab · 少儿风模拟器
        <div style={{ marginTop: '0.75rem' }}>
          <button className="nav-button" onClick={() => setPage('play')}>PlayLab（建表+查询）</button>
          <button className="nav-button" onClick={() => setPage('sample')}>SampleDB（只跑查询）</button>
        </div>
      </header>

      {page === 'play' ? <PlayLab /> : <SampleDB />}
      <footer style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
        Version {APP_VERSION} Where SQL is fun and easy! <br />
      </footer>
    </div>
    
  );
}
