import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function GemmaAssistant({ context, mode = 'explain', title = 'Ask Gemma', fallback = '' }) {
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [level, setLevel] = useState(0);
  const [lang, setLang] = useState('English');
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/gemma`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, context, question, level, lang }),
      });
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      setText(data.text);
      if (mode === 'hint') setLevel((l) => Math.min(l + 1, 3));
    } catch {
      // Demo safety: backend ya quota fail ho to pehle se likha jawab dikhao
      setText(fallback || 'Assistant abhi available nahi hai. Thodi der baad try karo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E5E9E4', borderRadius: 14, padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.85rem', color: '#0B1C30' }}>
        <Sparkles size={15} /> {title}
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '0.6rem 0', flexWrap: 'wrap' }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Apna sawal likho (optional)"
          style={{ flex: 1, minWidth: 180, padding: '0.45rem 0.7rem', border: '1px solid #E5E9E4', borderRadius: 8, fontSize: '0.8rem' }}
        />
        <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ border: '1px solid #E5E9E4', borderRadius: 8, padding: '0.4rem' }}>
          <option>English</option>
          <option>Hindi</option>
        </select>
        <button className="btn-ink" onClick={ask} disabled={loading} style={{ fontSize: '0.8rem', fontWeight: 600 }}>
          {loading ? 'Soch raha hai...' : mode === 'hint' ? `Hint ${level + 1}` : 'Samjhao'}
        </button>
      </div>
      {text && <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem', color: '#0B1C30', margin: 0 }}>{text}</p>}
    </div>
  );
}
