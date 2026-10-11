'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  function toggle() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    setDark(next === 'dark');
  }
  return (
    <button type="button" aria-label="切換深淺色模式" onClick={toggle} className="icon-button">
      {dark ? '☀' : '☾'}
    </button>
  );
}
