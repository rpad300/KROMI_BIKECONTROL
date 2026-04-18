/**
 * Refined v2 Desktop Sidebar
 *
 * Design direction:
 * - 220px width (was 240px — tighter)
 * - JetBrains Mono brand name with mint accent
 * - Active item: 2px left border with subtle glow + translucent bg
 * - Device code in font-mono
 * - All colors via var(--ev-*) tokens
 * - Tailwind classes instead of inline styles
 */

export interface SidebarNavItem {
  label: string;
  icon: string;
  screen: string;
  color?: string;
  subs?: { id: string; label: string; icon: string }[];
}

interface SidebarProps {
  navItems: SidebarNavItem[];
  activeScreen: string;
  activeSub: string;
  expanded: string | null;
  onNav: (item: SidebarNavItem, subId?: string) => void;
  onExpand: (label: string | null) => void;
  userEmail?: string;
  deviceId?: string;
  onLogout: () => void;
}

export function SidebarRefined({
  navItems, activeScreen, activeSub, expanded,
  onNav, onExpand, userEmail, deviceId, onLogout,
}: SidebarProps) {
  return (
    <aside
      className="flex flex-col overflow-auto"
      style={{
        width: '220px',
        flexShrink: 0,
        backgroundColor: 'var(--ev-surface-low)',
        borderRight: '1px solid var(--ev-outline-subtle)',
      }}
    >
      {/* ── Brand ── */}
      <div className="px-4 py-5" style={{ borderBottom: '1px solid var(--ev-outline-subtle)' }}>
        <h1 className="font-mono font-bold text-base tracking-[-0.03em]"
            style={{ color: 'var(--ev-primary)' }}>
          STEALTH-EV
        </h1>
        <p className="text-eyebrow mt-1" style={{ color: 'var(--ev-on-surface-muted)' }}>
          BIKECONTROL DESKTOP
        </p>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 py-2 px-2 space-y-0.5">
        {navItems.map((item) => {
          const isExpanded = expanded === item.label && !!item.subs;
          const hasActiveSub = item.subs?.some((s) => s.id === activeSub) && activeScreen === item.screen;
          const isActive = (!item.subs && activeScreen === item.screen) || hasActiveSub;
          const accentColor = item.color ?? 'var(--ev-primary)';

          return (
            <div key={item.label}>
              {/* Main nav item */}
              <button
                onClick={() => {
                  onNav(item);
                  if (item.subs) onExpand(expanded === item.label ? null : item.label);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                style={{
                  backgroundColor: isActive ? 'var(--ev-primary-glow)' : 'transparent',
                  borderLeft: isActive ? `2px solid ${accentColor}` : '2px solid transparent',
                  boxShadow: isActive ? `inset 4px 0 12px -4px ${accentColor}40` : 'none',
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '18px',
                    color: isActive ? accentColor : 'var(--ev-on-surface-variant)',
                  }}
                >
                  {item.icon}
                </span>
                <span
                  className="font-display text-xs flex-1"
                  style={{
                    color: isActive ? 'var(--ev-on-surface)' : 'var(--ev-on-surface-variant)',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  {item.label}
                </span>
                {item.subs && (
                  <span
                    className="material-symbols-outlined transition-transform duration-200"
                    style={{
                      fontSize: '14px',
                      color: 'var(--ev-outline-variant)',
                      transform: isExpanded ? 'rotate(180deg)' : 'none',
                    }}
                  >
                    expand_more
                  </span>
                )}
              </button>

              {/* Submenu */}
              {isExpanded && item.subs && (
                <div className="ml-5 mb-1">
                  {item.subs.map((s) => {
                    const isSubActive = hasActiveSub && activeSub === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => onNav(item, s.id)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors"
                        style={{
                          backgroundColor: isSubActive ? 'rgba(63,255,139,0.04)' : 'transparent',
                          borderLeft: isSubActive ? `2px solid ${accentColor}` : '2px solid transparent',
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: '14px',
                            color: isSubActive ? accentColor : 'var(--ev-on-surface-muted)',
                          }}
                        >
                          {s.icon}
                        </span>
                        <span
                          className="text-[11px]"
                          style={{
                            color: isSubActive ? 'var(--ev-on-surface)' : 'var(--ev-on-surface-muted)',
                            fontWeight: isSubActive ? 600 : 400,
                          }}
                        >
                          {s.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── Device ID ── */}
      {deviceId && (
        <div className="px-4 py-2" style={{ borderTop: '1px solid var(--ev-outline-subtle)' }}>
          <span className="text-eyebrow" style={{ color: 'var(--ev-outline-variant)' }}>DEVICE</span>
          <p className="font-mono text-[10px] mt-0.5 truncate"
             style={{ color: 'var(--ev-on-surface-muted)' }}>
            {deviceId}
          </p>
        </div>
      )}

      {/* ── User + Logout ── */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--ev-outline-subtle)' }}>
        <p className="text-[10px] truncate font-body" style={{ color: 'var(--ev-on-surface-muted)' }}>
          {userEmail}
        </p>
        <button
          onClick={onLogout}
          className="mt-1.5 text-[10px] font-display transition-colors hover:opacity-80"
          style={{ color: 'var(--ev-error)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Terminar sessao
        </button>
      </div>
    </aside>
  );
}
