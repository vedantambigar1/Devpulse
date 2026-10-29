'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { normalizeUsername } from '@/lib/username';

export function HeroForm() {
  const router = useRouter();
  const [u, setU] = useState('');
  return (
    <form
      className="try"
      onSubmit={(e) => {
        e.preventDefault();
        const name = normalizeUsername(u);
        router.push(name ? `/builder?u=${encodeURIComponent(name)}` : '/builder');
      }}
    >
      <input
        className="input"
        placeholder="Your GitHub username"
        value={u}
        onChange={(e) => setU(e.target.value)}
        aria-label="GitHub username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button className="btn btn-ink" type="submit">Build my widget</button>
    </form>
  );
}
