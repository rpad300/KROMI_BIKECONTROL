import { useState, useEffect } from 'react';

export function ClockDisplay() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: '12px', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{time}</span>
      <span style={{ fontFamily: "'Space Grotesk'", fontSize: '9px', color: '#777575', fontVariantNumeric: 'tabular-nums' }}>{date}</span>
    </div>
  );
}
