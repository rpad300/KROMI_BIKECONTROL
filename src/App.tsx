import { useState, useEffect } from 'react';
import { DashboardController } from './components/DashboardSystem/DashboardController';
import { MapView } from './components/Map/MapView';
import { ClimbApproach } from './components/Climb/ClimbApproach';
import { ConnectionsPage as Connections } from './components/Connections/ConnectionsPage';
import { Settings } from './components/Settings/Settings';
import { RideHistory } from './components/History/RideHistory';
import { LoginPage } from './components/Auth/LoginPage';
import { ConnectionStatus } from './components/shared/ConnectionStatus';
import { BridgeSetup } from './components/shared/BridgeSetup';
import { useGeolocation } from './hooks/useGeolocation';
import { useMotorControl } from './hooks/useMotorControl';
import { useRouteNavigation } from './hooks/useRouteNavigation';
import { NavigationBar } from './components/Dashboard/NavigationBar';
import { useAuthStore } from './store/authStore';
import { usePermissions } from './hooks/usePermission';
import {
  NAV_CATEGORIES,
  NAV_PERMISSION_KEYS,
  filterNavByPermissions,
  type NavCategory,
} from './config/navigation';
import { usePlatform } from './hooks/usePlatform';
import { useDriveBootstrap } from './hooks/useDriveBootstrap';
import { ImpersonationBanner } from './components/Admin/ImpersonationBanner';
import { DesktopLiveView } from './components/Desktop/DesktopLiveView';
import { GlobalMapView } from './components/Map/GlobalMapView';
import { startSettingsSync, loadSettingsFromDB } from './services/sync/SettingsSyncService';
import { trackLogin } from './services/sync/LoginTracker';
import { useGlanceStore } from './store/glanceStore';
import { AmbientGlance } from './components/DashboardSystem/AmbientGlance';
import { RescueAlert } from './components/shared/RescueAlert';
import { DiagBadge } from './components/shared/DiagBadge';
import { Component, type ReactNode } from 'react';

class DiagSafe extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? null : this.props.children; }
}

type MobileScreen = 'dashboard' | 'map' | 'climb' | 'connections' | 'settings' | 'history';
type DesktopScreen = 'live' | 'settings' | 'history' | 'map';

export function App() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checkSession = useAuthStore((s) => s.checkSession);
  const applyImpersonationFromUrl = useAuthStore((s) => s.applyImpersonationFromUrl);
  const [impersonationApplied, setImpersonationApplied] = useState(false);

  useEffect(() => { checkSession(); }, [checkSession]);

  // Once the admin session is loaded, look for ?as=<uuid> in the URL.
  // If present, switch this tab's state to the target user and reload
  // their settings from the DB so the UI actually reflects their data.
  useEffect(() => {
    if (loading || !user) return;
    if (impersonationApplied) return;
    if (typeof window === 'undefined') return;
    if (!new URLSearchParams(window.location.search).has('as')) {
      setImpersonationApplied(true);
      return;
    }
    (async () => {
      const ok = await applyImpersonationFromUrl();
      if (ok) {
        // Pull target user's bikes, bike_config, rider_profile, etc.
        await loadSettingsFromDB();
      }
      setImpersonationApplied(true);
    })();
  }, [loading, user, applyImpersonationFromUrl, impersonationApplied]);

  if (loading || !impersonationApplied) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0e0e0e]">
        <div className="w-10 h-10 border-2 border-[#3fff8b] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <>
      <ImpersonationBanner />
      <MainApp />
    </>
  );
}

function MainApp() {
  const platform = usePlatform();

  // Bootstrap KROMI Drive folders for this user (idempotent, fire-and-forget)
  useDriveBootstrap();

  // Sync settings from/to DB + track login (once on mount)
  useEffect(() => {
    trackLogin();
    const unsub = startSettingsSync();
    return unsub;
  }, []);

  return platform === 'mobile' ? <MobileApp /> : <DesktopApp />;
}

// ═══════════════════════════════════════════════════
// MOBILE — full PWA with BLE, dashboard, motor control
// ═══════════════════════════════════════════════════

function MobileApp() {
  const [screen, setScreen] = useState<MobileScreen>('dashboard');

  useGeolocation();
  useMotorControl();
  useRouteNavigation();

  // Glance mode — tick idle counter every 1s
  useEffect(() => {
    const id = setInterval(() => useGlanceStore.getState().tick(), 1000);
    return () => clearInterval(id);
  }, []);

  // Reset glance idle on any touch
  const resetGlance = () => useGlanceStore.getState().resetIdle();

  return (
    <div className="h-full flex flex-col bg-[#0e0e0e] text-white">
      <DiagSafe><DiagBadge /></DiagSafe>
      {/* Navigation bar — only visible when following a route */}
      <NavigationBar />
      {/* Content — no scroll on dashboard, scroll on settings/history */}
      <div
        className={`flex-1 min-h-0 ${screen === 'settings' || screen === 'history' ? 'overflow-y-auto' : 'overflow-hidden'}`}
        onTouchStart={resetGlance}
      >
        {screen === 'dashboard' && <DashboardController />}
        {screen === 'map' && <MapView />}
        {screen === 'climb' && <ClimbApproach />}
        {screen === 'connections' && <Connections />}
        {screen === 'settings' && <Settings onNavigate={setScreen} />}
        {screen === 'history' && <RideHistory />}
      </div>

      {/* Bottom Nav — Stitch style */}
      <nav className="flex-none flex justify-around items-center h-20 bg-[#0e0e0e]/90 backdrop-blur-xl border-t border-[#3fff8b]/10 shadow-[0_-4px_24px_rgba(0,0,0,0.8)]">
        <NavButton label="Dash" icon="speed" active={screen === 'dashboard'} onClick={() => setScreen('dashboard')} />
        <NavButton label="Map" icon="map" active={screen === 'map'} onClick={() => setScreen('map')} />
        <NavButton label="Climb" icon="terrain" active={screen === 'climb'} onClick={() => setScreen('climb')} />
        <NavButton label="BLE" icon="settings_bluetooth" active={screen === 'connections'} onClick={() => setScreen('connections')} />
        <NavButton label="Setup" icon="settings" active={screen === 'settings'} onClick={() => setScreen('settings')} />
      </nav>

      <ConnectionStatus />
      <BridgeSetup />
      <AmbientGlance />
      <RescueAlert />
    </div>
  );
}

// ═══════════════════════════════════════════════════
// DESKTOP — config, history, map review (no BLE needed)
// ═══════════════════════════════════════════════════

type DesktopSub = string; // e.g., 'live:preview', 'settings:rider', etc.

interface NavSub {
  id: string;
  label: string;
  icon: string;
}
interface NavItem {
  screen: DesktopScreen;
  label: string;
  icon: string;
  color?: string;
  subs?: NavSub[];
}

/** Convert a category from the canonical NAV_CATEGORIES into the desktop NavItem shape. */
function categoryToDesktopNavItem(cat: NavCategory): NavItem {
  // Categories with navigateTo are top-level shortcuts (history, map)
  if (cat.navigateTo && cat.items.length === 0) {
    return {
      screen: cat.navigateTo as DesktopScreen,
      label: cat.label,
      icon: cat.icon,
      color: cat.color,
    };
  }
  return {
    screen: 'settings',
    label: cat.label,
    icon: cat.icon,
    color: cat.color,
    subs: cat.items.map((it) => ({ id: it.id, label: it.label, icon: it.icon })),
  };
}

/** "Volta Live" is desktop-only (no mobile equivalent), so it stays here. */
const VOLTA_LIVE_NAV: NavItem = {
  screen: 'live',
  label: 'Volta Live',
  icon: 'directions_bike',
  color: '#3fff8b',
  subs: [
    { id: 'preview', label: 'Dashboard Preview', icon: 'phone_iphone' },
    { id: 'builder', label: 'Custom Builder', icon: 'construction' },
    { id: 'range', label: 'Autonomia', icon: 'battery_charging_full' },
    { id: 'widgets', label: 'Widget Library', icon: 'widgets' },
  ],
};

// Super-admin-only entry — injected dynamically in DesktopApp
const ADMIN_NAV: NavItem[] = [
  { screen: 'settings', label: 'Super Admin', icon: 'admin_panel_settings', color: '#ff9f43', subs: [
    { id: 'super-admin', label: 'Painel Admin', icon: 'admin_panel_settings' },
  ]},
];

function DesktopApp() {
  const [screen, setScreen] = useState<DesktopScreen>('live');
  const [sub, setSub] = useState<DesktopSub>('preview');
  const [expanded, setExpanded] = useState<string | null>('Volta Live');
  const user = useAuthStore((s) => s.user);
  const realUser = useAuthStore((s) => s.realUser);
  const impersonatedUser = useAuthStore((s) => s.impersonatedUser);
  const logout = useAuthStore((s) => s.logout);
  // Hide the Super Admin entry while impersonating so the sidebar is a
  // faithful mirror of the target's view. Exit by closing the tab.
  const isSuperAdmin = !impersonatedUser && !!realUser?.is_super_admin;
  const perms = usePermissions(NAV_PERMISSION_KEYS);

  // Apply RBAC filter against the canonical NAV_CATEGORIES, then convert to
  // the desktop sidebar shape and prepend the desktop-only "Volta Live".
  const filteredNav: NavItem[] = [
    VOLTA_LIVE_NAV,
    ...filterNavByPermissions(NAV_CATEGORIES, perms).map(categoryToDesktopNavItem),
  ];
  // Remove any settings categories that ended up with zero subs after filtering
  const cleanedNav = filteredNav.filter((it) => !it.subs || it.subs.length > 0);

  const navItems = isSuperAdmin ? [...cleanedNav, ...ADMIN_NAV] : cleanedNav;

  const handleNav = (item: NavItem, subId?: string) => {
    setScreen(item.screen);
    if (item.subs) {
      setExpanded(expanded === item.label ? null : item.label);
      if (subId) setSub(subId);
      else if (item.subs[0]) setSub(item.subs[0].id);
    } else {
      setExpanded(null);
    }
  };

  return (
    <div className="h-full flex bg-[#0e0e0e] text-white">
      <DiagSafe><DiagBadge /></DiagSafe>
      {/* Sidebar with expandable submenus */}
      <aside style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(73,72,71,0.2)', backgroundColor: '#131313', overflow: 'auto' }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px', borderBottom: '1px solid rgba(73,72,71,0.2)' }}>
          <h1 className="font-headline font-bold" style={{ fontSize: '18px', color: '#3fff8b', letterSpacing: '-0.02em' }}>STEALTH-EV</h1>
          <p className="font-label" style={{ fontSize: '9px', color: '#777575', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: '2px' }}>BikeControl Desktop</p>
        </div>

        {/* Nav items with submenus */}
        <nav style={{ flex: 1, padding: '8px' }}>
          {navItems.map((item) => {
            const isExpanded = expanded === item.label && item.subs;
            const hasActiveSub = item.subs?.some((s) => s.id === sub) && screen === item.screen;
            const isActive = (!item.subs && screen === item.screen) || hasActiveSub;
            return (
              <div key={item.label}>
                {/* Main nav item */}
                <button
                  onClick={() => handleNav(item)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    backgroundColor: isActive ? 'rgba(63,255,139,0.08)' : 'transparent',
                    borderLeft: isActive ? `2px solid ${item.color ?? '#3fff8b'}` : '2px solid transparent',
                    marginBottom: '2px',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: isActive ? (item.color ?? '#3fff8b') : '#adaaaa' }}>{item.icon}</span>
                  <span className="font-label" style={{ fontSize: '12px', color: isActive ? 'white' : '#adaaaa', fontWeight: isActive ? 700 : 400, flex: 1 }}>{item.label}</span>
                  {item.subs && (
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>expand_more</span>
                  )}
                </button>

                {/* Submenu */}
                {isExpanded && item.subs && (
                  <div style={{ marginLeft: '20px', marginBottom: '4px' }}>
                    {item.subs.map((s) => {
                      const isSubActive = isActive && sub === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => { setScreen(item.screen); setSub(s.id); }}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '7px 10px', border: 'none', cursor: 'pointer', textAlign: 'left',
                            backgroundColor: isSubActive ? 'rgba(63,255,139,0.05)' : 'transparent',
                            borderLeft: isSubActive ? `2px solid ${item.color ?? '#3fff8b'}` : '2px solid transparent',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '14px', color: isSubActive ? (item.color ?? '#3fff8b') : '#777575' }}>{s.icon}</span>
                          <span style={{ fontSize: '11px', color: isSubActive ? 'white' : '#777575', fontWeight: isSubActive ? 600 : 400 }}>{s.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User + logout */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(73,72,71,0.2)' }}>
          <div style={{ fontSize: '10px', color: '#777575' }}>{user?.email}</div>
          <button onClick={logout} style={{ marginTop: '6px', fontSize: '10px', color: '#ff716c', background: 'none', border: 'none', cursor: 'pointer' }}>
            Terminar sessão
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {screen === 'map' ? (
          <GlobalMapView />
        ) : (
          <div className="py-4 px-6">
            {screen === 'live' && <DesktopLiveView activeTab={sub} />}
            {screen === 'settings' && <Settings initialPage={sub as 'rider' | 'bike' | 'kromi' | 'bluetooth' | 'routes' | 'account' | 'super-admin'} />}
            {screen === 'history' && <RideHistory />}
          </div>
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Shared components
// ═══════════════════════════════════════════════════

function NavButton({ label, icon, active, onClick }: {
  label: string; icon: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-16 h-16 active:scale-90 transition-all duration-150 ${
        active
          ? 'bg-[#3fff8b] text-black rounded-sm'
          : 'text-zinc-400 hover:text-[#3fff8b]'
      }`}
    >
      <span
        className="material-symbols-outlined text-2xl"
        style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
      >{icon}</span>
      <span className="font-body font-bold text-[10px] uppercase mt-1">{label}</span>
    </button>
  );
}
