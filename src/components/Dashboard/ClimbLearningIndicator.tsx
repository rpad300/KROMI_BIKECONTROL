import { useEffect, useState } from 'react';
import { useIntelligenceStore } from '../../store/intelligenceStore';

/**
 * ClimbLearningIndicator — floating badge when a familiar climb is detected.
 * Appears when the intelligence engine's factors include "ClimbLearn".
 * Auto-hides when the climb factor disappears.
 */
export function ClimbLearningIndicator() {
  const factors = useIntelligenceStore((s) => s.factors);
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState('');

  useEffect(() => {
    const climbFactor = factors.find((f) => f.name === 'ClimbLearn');
    if (climbFactor) {
      setDetail(climbFactor.detail);
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [factors]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-28 left-0 right-0 mx-4 z-40 pointer-events-none">
      <div className="inline-flex items-center gap-2 bg-[#131313]/95 border-l-2 border-[#3fff8b] px-3 py-2 rounded shadow-lg shadow-black/40">
        <span
          className="material-symbols-outlined text-[#3fff8b]"
          style={{ fontSize: '16px' }}
        >
          trending_up
        </span>
        <div>
          <div className="text-[9px] font-label uppercase tracking-widest text-[#3fff8b]">
            LEARNED CLIMB
          </div>
          <div className="text-[11px] text-[#adaaaa] font-label">
            {detail}
          </div>
        </div>
      </div>
    </div>
  );
}
