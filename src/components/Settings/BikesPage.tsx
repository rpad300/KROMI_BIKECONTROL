import { useState, useEffect } from 'react';
import {
  useSettingsStore, safeBikeConfig,
  bikeCategoryLabel, suspensionLabel,
  type BikeConfig, type BikeCategory, type SuspensionType, type BrakeType,
  type DrivetrainType, type GroupsetBrand,
} from '../../store/settingsStore';
import { useBikeStore } from '../../store/bikeStore';
import { AutocompleteField } from '../shared/AutocompleteField';
import { getTopComponents, type BikeComponent } from '../../services/bike/BikeComponentService';

// ═══════════════════════════════════════════════════════════
// BIKE LIST — shows all bikes, active toggle, add, click→detail
// ═══════════════════════════════════════════════════════════

export function BikesPage() {
  const bikes = useSettingsStore((s) => s.bikes);
  const activeBikeId = useSettingsStore((s) => s.activeBikeId);
  const addBike = useSettingsStore((s) => s.addBike);
  const removeBike = useSettingsStore((s) => s.removeBike);
  const selectBike = useSettingsStore((s) => s.selectBike);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'ebike' | 'mechanical'>('ebike');
  const [newCategory, setNewCategory] = useState<BikeCategory>('mtb');

  // Edit a specific bike — select it first so store is in sync
  if (editingId) {
    const editBike = bikes.find((b) => b.id === editingId);
    if (editBike) {
      return <BikeDetailPage bikeId={editingId} onBack={() => setEditingId(null)} />;
    }
  }

  return (
    <div className="space-y-3">
      <SectionHeader icon="pedal_bike" color="#3fff8b" label="As minhas bicicletas" count={bikes.length} />

      {/* Bike list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {bikes.map((b) => {
          const safe = safeBikeConfig(b);
          const isActive = b.id === activeBikeId;
          const isE = safe.bike_type === 'ebike';
          const accent = isE ? '#3fff8b' : '#6e9bff';

          // Build spec tags
          const tags: string[] = [];
          tags.push(bikeCategoryLabel(safe.category));
          if (safe.suspension !== 'rigid') tags.push(suspensionLabel(safe.suspension));
          if (isE) tags.push('E-Bike');
          if (safe.wheel_size) tags.push(safe.wheel_size);
          if (safe.frame_material) tags.push(safe.frame_material === 'carbon' ? 'Carbono' : safe.frame_material === 'aluminium' ? 'Alumínio' : safe.frame_material);

          // Suspension summary
          const susText = safe.suspension === 'full'
            ? `${safe.fork_travel_mm}/${safe.rear_travel_mm}mm`
            : safe.suspension === 'hardtail'
              ? `${safe.fork_travel_mm}mm`
              : '';

          // Purchase date formatting
          const purchaseText = safe.purchase_date
            ? new Date(safe.purchase_date).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' })
            : '';

          return (
            <button
              key={b.id}
              onClick={() => setEditingId(b.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '14px', cursor: 'pointer',
                backgroundColor: isActive ? 'rgba(63,255,139,0.04)' : '#131313',
                borderLeft: `3px solid ${isActive ? accent : '#494847'}`,
                borderRadius: '6px', border: 'none',
                borderTop: isActive ? `1px solid ${accent}20` : '1px solid transparent',
                borderRight: isActive ? `1px solid ${accent}10` : '1px solid transparent',
                borderBottom: isActive ? `1px solid ${accent}10` : '1px solid transparent',
              }}
            >
              {/* Top row: icon + name + active badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '32px', color: accent }}>
                  {isE ? 'electric_bike' : 'pedal_bike'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>{safe.name}</span>
                    {isActive && (
                      <span style={{ fontSize: '8px', padding: '2px 6px', backgroundColor: accent, color: 'black', fontWeight: 900, borderRadius: '2px' }}>ACTIVA</span>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: '#777575', marginTop: '1px' }}>
                    {safe.brand} {safe.model}
                    {safe.size ? ` · ${safe.size}` : ''}
                    {safe.year > 0 ? ` · ${safe.year}` : ''}
                  </div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847' }}>chevron_right</span>
              </div>

              {/* Tags row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                {tags.map((t) => (
                  <span key={t} style={{ fontSize: '9px', padding: '2px 6px', backgroundColor: 'rgba(73,72,71,0.15)', color: '#adaaaa', borderRadius: '3px', fontWeight: 600 }}>{t}</span>
                ))}
              </div>

              {/* AI summary */}
              <AiBikeSummary bike={safe} />

              {/* Specs row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px', fontSize: '10px', color: '#777575' }}>
                {safe.weight_kg > 0 && (
                  <span><span className="material-symbols-outlined" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '2px' }}>monitor_weight</span>{safe.weight_kg.toFixed(1)}kg</span>
                )}
                {susText && (
                  <span><span className="material-symbols-outlined" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '2px' }}>swap_vert</span>{susText}</span>
                )}
                {isE && safe.motor_name && (
                  <span><span className="material-symbols-outlined" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '2px' }}>bolt</span>{safe.motor_name}</span>
                )}
                {isE && safe.main_battery_wh > 0 && (
                  <span><span className="material-symbols-outlined" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '2px' }}>battery_full</span>{safe.main_battery_wh + (safe.has_range_extender ? safe.sub_battery_wh : 0)}Wh</span>
                )}
                {safe.groupset_model && (
                  <span><span className="material-symbols-outlined" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '2px' }}>settings</span>{safe.groupset_model}</span>
                )}
                {safe.drivetrain_type && safe.cassette_speeds > 0 && (
                  <span>{safe.drivetrain_type} {safe.cassette_speeds}v</span>
                )}
                {safe.brake_model && (
                  <span><span className="material-symbols-outlined" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '2px' }}>do_not_disturb_on</span>{safe.brake_model.split(' ').slice(0, 3).join(' ')}</span>
                )}
              </div>

              {/* Bottom row: purchase date + actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                <div style={{ fontSize: '9px', color: '#494847' }}>
                  {purchaseText && <span>Comprada: {purchaseText}</span>}
                  {safe.fork_model && <span>{purchaseText ? ' · ' : ''}Fork: {safe.fork_model}</span>}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {!isActive && (
                    <span
                      onClick={(e) => { e.stopPropagation(); selectBike(b.id); }}
                      style={{ fontSize: '9px', padding: '2px 8px', backgroundColor: 'rgba(73,72,71,0.2)', color: '#777575', borderRadius: '3px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Activar
                    </span>
                  )}
                  {bikes.length > 1 && (
                    <span
                      onClick={(e) => { e.stopPropagation(); if (confirm(`Apagar ${safe.name}?`)) removeBike(b.id); }}
                      style={{ fontSize: '9px', padding: '2px 8px', backgroundColor: 'rgba(255,113,108,0.1)', color: '#ff716c', borderRadius: '3px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Apagar
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Add bike form */}
      {showAdd ? (
        <div style={{ backgroundColor: '#131313', padding: '14px', borderRadius: '8px', border: '1px solid rgba(63,255,139,0.15)' }}>
          <div className="font-headline font-bold" style={{ fontSize: '13px', color: '#3fff8b', marginBottom: '10px' }}>Nova Bicicleta</div>

          <InputField label="Nome" value={newName} onChange={setNewName} placeholder="Ex: Giant Trance X E+ 2" />

          {/* Type toggle */}
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Tipo</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <ChipButton active={newType === 'ebike'} color="#3fff8b" onClick={() => setNewType('ebike')}>E-Bike</ChipButton>
              <ChipButton active={newType === 'mechanical'} color="#6e9bff" onClick={() => setNewType('mechanical')}>Mecânica</ChipButton>
            </div>
          </div>

          {/* Category */}
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Categoria</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {(['mtb', 'road', 'gravel', 'urban', 'cx', 'tt', 'other'] as BikeCategory[]).map((cat) => (
                <ChipButton key={cat} active={newCategory === cat} color="#e966ff" onClick={() => setNewCategory(cat)}>
                  {bikeCategoryLabel(cat)}
                </ChipButton>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
            <button
              onClick={() => {
                if (!newName.trim()) return;
                addBike({ name: newName.trim(), bike_type: newType, category: newCategory });
                setShowAdd(false);
                setNewName('');
                // Open the detail page for the newly added bike
              }}
              style={{ flex: 1, padding: '10px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer', borderRadius: '4px' }}
            >
              Adicionar
            </button>
            <button
              onClick={() => setShowAdd(false)}
              style={{ padding: '10px 16px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', fontSize: '13px', cursor: 'pointer', borderRadius: '4px' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          style={{
            width: '100%', padding: '12px', backgroundColor: '#131313', border: '1px dashed #494847',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            color: '#adaaaa', fontSize: '12px', borderRadius: '4px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
          Adicionar bicicleta
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// BIKE DETAIL — comprehensive config page
// ═══════════════════════════════════════════════════════════

function BikeDetailPage({ bikeId, onBack }: { bikeId: string; onBack: () => void }) {
  const selectBike = useSettingsStore((s) => s.selectBike);
  const activeBikeId = useSettingsStore((s) => s.activeBikeId);
  const updateBikeConfig = useSettingsStore((s) => s.updateBikeConfig);

  // Select this bike so bikeConfig is in sync
  if (activeBikeId !== bikeId) selectBike(bikeId);

  // Read reactively from store — re-renders on every update
  const bike = safeBikeConfig(useSettingsStore((s) => s.bikeConfig));

  const update = (partial: Partial<BikeConfig>) => updateBikeConfig(partial);
  const isEBike = bike.bike_type === 'ebike';

  return (
    <div className="space-y-4">
      {/* Header with back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#adaaaa' }}>arrow_back</span>
        </button>
        <div style={{ flex: 1 }}>
          <div className="font-headline font-bold" style={{ fontSize: '16px', color: '#3fff8b' }}>{bike.name}</div>
          <div style={{ fontSize: '10px', color: '#777575' }}>
            {bikeCategoryLabel(bike.category)} · {suspensionLabel(bike.suspension)}
            {isEBike ? ' · E-Bike' : ''}
          </div>
        </div>
        <span className="material-symbols-outlined" style={{ fontSize: '28px', color: isEBike ? '#3fff8b' : '#6e9bff' }}>
          {isEBike ? 'electric_bike' : 'pedal_bike'}
        </span>
      </div>

      {/* ── Bike Model Picker — load from DB ────────────── */}
      <BikeModelPicker bike={bike} onApply={(specs) => {
        const s = specs as Record<string, unknown>;
        update({
          bike_type: (s.bike_type as 'ebike' | 'mechanical') ?? bike.bike_type,
          category: (s.category as BikeCategory) ?? bike.category,
          suspension: (s.suspension as SuspensionType) ?? bike.suspension,
          frame_material: (s.frame_material as string) ?? bike.frame_material,
          fork_travel_mm: (s.fork_travel_mm as number) ?? bike.fork_travel_mm,
          rear_travel_mm: (s.rear_travel_mm as number) ?? bike.rear_travel_mm,
          wheel_size: (s.wheel_size as string) ?? bike.wheel_size,
          wheel_circumference_mm: s.wheel_size === '29"' ? 2290 : s.wheel_size === '27.5"' ? 2168 : s.wheel_size === '700c' ? 2105 : bike.wheel_circumference_mm,
          fork_model: (s.fork as string) ?? bike.fork_model,
          rear_shock_model: (s.shock as string) ?? bike.rear_shock_model,
          brake_model: (s.brake as string) ?? bike.brake_model,
          groupset_model: (s.groupset as string) ?? bike.groupset_model,
          motor_name: (s.motor as string) ?? bike.motor_name,
          main_battery_wh: (s.battery_wh as number) ?? bike.main_battery_wh,
          cassette_range: (s.cassette as string) ?? bike.cassette_range,
          drivetrain_type: (s.drivetrain as string)?.startsWith('1') ? '1x' : (s.drivetrain as string)?.startsWith('2') ? '2x' : bike.drivetrain_type,
          weight_kg: s._weight_kg ? (s._weight_kg as number) : bike.weight_kg,
          rotor_front_mm: (s.rotor_front_mm as number) ?? bike.rotor_front_mm,
          rotor_rear_mm: (s.rotor_rear_mm as number) ?? bike.rotor_rear_mm,
        });
      }} />

      {/* ── Section: General ─────────────────────────────── */}
      <SectionHeader icon="info" color="#3fff8b" label="Geral" />
      <Card>
        <InputField label="Nome" value={bike.name} onChange={(v) => update({ name: v })} />
        <InputField label="Marca" value={bike.brand} onChange={(v) => update({ brand: v })} placeholder="Giant, Trek, Specialized..." />
        <InputField label="Modelo" value={bike.model} onChange={(v) => update({ model: v })} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}><NumField label="Ano" value={bike.year} onChange={(v) => update({ year: v })} /></div>
          <div style={{ flex: 1 }}><InputField label="Tamanho" value={bike.size} onChange={(v) => update({ size: v })} placeholder="S, M, L, 54cm" /></div>
        </div>
        <NumField label="Peso (kg)" value={bike.weight_kg} onChange={(v) => update({ weight_kg: v })} step={0.1} />
        <InputField label="Cor" value={bike.color} onChange={(v) => update({ color: v })} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>Data de compra</div>
            <input type="date" value={bike.purchase_date} onChange={(e) => update({ purchase_date: e.target.value })}
              style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: 'white', fontSize: '12px', outline: 'none' }} />
          </div>
          <div style={{ flex: 1 }}>
            <InputField label="Nº de série" value={bike.serial_number} onChange={(v) => update({ serial_number: v })} placeholder="XXXXXX" />
          </div>
        </div>

        {/* Type */}
        <div style={{ marginTop: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Tipo</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <ChipButton active={bike.bike_type === 'ebike'} color="#3fff8b" onClick={() => update({ bike_type: 'ebike' })}>E-Bike</ChipButton>
            <ChipButton active={bike.bike_type === 'mechanical'} color="#6e9bff" onClick={() => update({ bike_type: 'mechanical' })}>Mecânica</ChipButton>
          </div>
        </div>

        {/* Category */}
        <div style={{ marginTop: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Categoria</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {(['mtb', 'road', 'gravel', 'urban', 'cx', 'tt', 'other'] as BikeCategory[]).map((cat) => (
              <ChipButton key={cat} active={bike.category === cat} color="#e966ff" onClick={() => update({ category: cat })}>
                {bikeCategoryLabel(cat)}
              </ChipButton>
            ))}
          </div>
        </div>

        {/* Suspension */}
        <div style={{ marginTop: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Suspensão</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['rigid', 'hardtail', 'full'] as SuspensionType[]).map((s) => (
              <ChipButton key={s} active={bike.suspension === s} color="#fbbf24" onClick={() => update({ suspension: s })}>
                {suspensionLabel(s)}
              </ChipButton>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Section: Frame & Geometry ────────────────────── */}
      <SectionHeader icon="straighten" color="#6e9bff" label="Quadro & Geometria" />
      <Card>
        <div style={{ marginBottom: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Material</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {['carbon', 'aluminium', 'steel', 'titanium'].map((m) => (
              <ChipButton key={m} active={bike.frame_material === m} color="#6e9bff" onClick={() => update({ frame_material: m })}>
                {m === 'carbon' ? 'Carbono' : m === 'aluminium' ? 'Alumínio' : m === 'steel' ? 'Aço' : 'Titânio'}
              </ChipButton>
            ))}
          </div>
        </div>

        {bike.suspension !== 'rigid' && (
          <>
            <AutocompleteField
              category="fork" label="Suspensão dianteira" value={bike.fork_model}
              onChange={(v) => update({ fork_model: v })} placeholder="Fox 36, RockShox Pike..."
              onSpecsReceived={(specs) => {
                if (specs.travel_mm) update({ fork_travel_mm: specs.travel_mm as number });
              }}
            />
            <NumField label="Travel dianteiro (mm)" value={bike.fork_travel_mm} onChange={(v) => update({ fork_travel_mm: v })} />
          </>
        )}
        {bike.suspension === 'full' && (
          <>
            <AutocompleteField
              category="shock" label="Amortecedor traseiro" value={bike.rear_shock_model}
              onChange={(v) => update({ rear_shock_model: v })} placeholder="Fox Float DPS, RS Deluxe..."
              onSpecsReceived={(specs) => {
                if (specs.travel_mm) update({ rear_travel_mm: specs.travel_mm as number });
              }}
            />
            <NumField label="Travel traseiro (mm)" value={bike.rear_travel_mm} onChange={(v) => update({ rear_travel_mm: v })} />
          </>
        )}

        <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px', marginTop: '6px' }}>Seatpost</div>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
          <ChipButton active={bike.seatpost_type === 'rigid'} color="#6e9bff" onClick={() => update({ seatpost_type: 'rigid' })}>Rígido</ChipButton>
          <ChipButton active={bike.seatpost_type === 'dropper'} color="#6e9bff" onClick={() => update({ seatpost_type: 'dropper' })}>Dropper</ChipButton>
        </div>
        {bike.seatpost_type === 'dropper' && (
          <NumField label="Travel dropper (mm)" value={bike.seatpost_travel_mm} onChange={(v) => update({ seatpost_travel_mm: v })} />
        )}
        <NumField label="Diâmetro seatpost (mm)" value={bike.seatpost_diameter_mm} onChange={(v) => update({ seatpost_diameter_mm: v })} step={0.1} />

        <SubLabel>Geometria</SubLabel>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <NumField label="Head angle (°)" value={bike.headtube_angle_deg} onChange={(v) => update({ headtube_angle_deg: v })} step={0.1} />
          <NumField label="Seat angle (°)" value={bike.seattube_angle_deg} onChange={(v) => update({ seattube_angle_deg: v })} step={0.1} />
          <NumField label="Reach (mm)" value={bike.reach_mm} onChange={(v) => update({ reach_mm: v })} />
          <NumField label="Stack (mm)" value={bike.stack_mm} onChange={(v) => update({ stack_mm: v })} />
          <NumField label="Chainstay (mm)" value={bike.chainstay_mm} onChange={(v) => update({ chainstay_mm: v })} />
          <NumField label="Wheelbase (mm)" value={bike.wheelbase_mm} onChange={(v) => update({ wheelbase_mm: v })} />
          <NumField label="BB drop (mm)" value={bike.bb_drop_mm} onChange={(v) => update({ bb_drop_mm: v })} />
        </div>
      </Card>

      {/* ── Section: Drivetrain ──────────────────────────── */}
      <SectionHeader icon="settings" color="#fbbf24" label="Transmissão" />
      <Card>
        <div style={{ marginBottom: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Configuração</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['1x', '2x', '3x'] as DrivetrainType[]).map((dt) => (
              <ChipButton key={dt} active={bike.drivetrain_type === dt} color="#fbbf24" onClick={() => update({ drivetrain_type: dt })}>
                {dt}
              </ChipButton>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Marca do grupo</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {(['shimano', 'sram', 'campagnolo', 'other'] as GroupsetBrand[]).map((gb) => (
              <ChipButton key={gb} active={bike.groupset_brand === gb} color="#fbbf24" onClick={() => update({ groupset_brand: gb })}>
                {gb === 'shimano' ? 'Shimano' : gb === 'sram' ? 'SRAM' : gb === 'campagnolo' ? 'Campagnolo' : 'Outro'}
              </ChipButton>
            ))}
          </div>
        </div>

        <AutocompleteField
          category="groupset" label="Modelo do grupo" value={bike.groupset_model}
          onChange={(v) => update({ groupset_model: v })} placeholder="Deore XT, GX Eagle AXS..."
          onSpecsReceived={(specs) => {
            if (specs.speeds) update({ cassette_speeds: specs.speeds as number });
            if (specs.type === 'electronic') update({ electronic_shifting: true });
          }}
        />

        <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
          <ChipButton active={!bike.electronic_shifting} color="#777575" onClick={() => update({ electronic_shifting: false })}>Mecânico</ChipButton>
          <ChipButton active={bike.electronic_shifting} color="#fbbf24" onClick={() => update({ electronic_shifting: true })}>Electrónico</ChipButton>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <NumField label="Crank (mm)" value={bike.crank_length_mm} onChange={(v) => update({ crank_length_mm: v })} />
          <NumField label="Velocidades" value={bike.cassette_speeds} onChange={(v) => update({ cassette_speeds: v })} />
        </div>
        <InputField label="Pratos" value={bike.chainring_teeth} onChange={(v) => update({ chainring_teeth: v })} placeholder="34T, 50/34T, 52/36T" />
        <AutocompleteField
          category="cassette" label="Cassete" value={bike.cassette_range}
          onChange={(v) => update({ cassette_range: v })} placeholder="Shimano XT 10-51T"
          onSpecsReceived={(specs) => {
            if (specs.range) update({ cassette_range: specs.range as string });
            if (specs.speeds) update({ cassette_speeds: specs.speeds as number });
            if (Array.isArray(specs.sprockets)) update({ cassette_sprockets: specs.sprockets as number[] });
          }}
        />
        {/* Individual sprocket teeth — editable */}
        <div>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>
            Dentes da cassete ({bike.cassette_sprockets?.length || 0} pratos)
          </div>
          <input
            type="text"
            value={bike.cassette_sprockets?.join(', ') ?? ''}
            onChange={(e) => {
              const nums = e.target.value.split(/[,\s·]+/).map((s) => parseInt(s.trim())).filter((n) => !isNaN(n) && n > 0);
              update({ cassette_sprockets: nums, cassette_speeds: nums.length || bike.cassette_speeds });
            }}
            placeholder="10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 51"
            style={{
              width: '100%', padding: '8px 10px', backgroundColor: '#0e0e0e',
              border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px',
              color: 'white', fontSize: '12px', outline: 'none', fontFamily: 'monospace',
            }}
          />
          <div style={{ fontSize: '9px', color: '#494847', marginTop: '2px' }}>
            Separa por vírgulas. Usado pelo KROMI Intelligence para calcular gear ratios e optimizar assist.
          </div>
        </div>
        <AutocompleteField category="chain" label="Corrente" value={bike.chain_model} onChange={(v) => update({ chain_model: v })} placeholder="Shimano CN-M8100" />
        <AutocompleteField category="pedal" label="Pedais" value={bike.pedals} onChange={(v) => update({ pedals: v })} placeholder="Shimano XT SPD, Crankbrothers..." />
      </Card>

      {/* ── Section: Wheels & Tyres ──────────────────────── */}
      <SectionHeader icon="trip_origin" color="#e966ff" label="Rodas & Pneus" />
      <Card>
        <div style={{ marginBottom: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Tamanho da roda</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {[
              { v: '29"', c: 2290 }, { v: '27.5"', c: 2168 }, { v: '700c', c: 2105 },
              { v: '650b', c: 2068 }, { v: '26"', c: 2060 }, { v: '20"', c: 1590 },
            ].map((ws) => (
              <ChipButton key={ws.v} active={bike.wheel_size === ws.v} color="#e966ff"
                onClick={() => update({ wheel_size: ws.v, wheel_circumference_mm: ws.c })}>
                {ws.v}
              </ChipButton>
            ))}
          </div>
        </div>
        <NumField label="Circunferência exacta (mm)" value={bike.wheel_circumference_mm} onChange={(v) => update({ wheel_circumference_mm: v })} />
        <NumField label="Largura interior do aro (mm)" value={bike.rim_width_mm} onChange={(v) => update({ rim_width_mm: v })} />

        <SubLabel>Aros</SubLabel>
        <AutocompleteField
          category="wheel" label="Aro dianteiro" value={bike.rim_model_front}
          onChange={(v) => update({ rim_model_front: v })}
          onSpecsReceived={(specs) => {
            if (specs.rim_width_mm) update({ rim_width_mm: specs.rim_width_mm as number });
          }}
        />
        <AutocompleteField category="wheel" label="Aro traseiro" value={bike.rim_model_rear} onChange={(v) => update({ rim_model_rear: v })} />

        <SubLabel>Cubos & Raios</SubLabel>
        <AutocompleteField category="hub" label="Cubo dianteiro" value={bike.hub_front} onChange={(v) => update({ hub_front: v })} placeholder="DT Swiss 350, I9 Hydra..." />
        <AutocompleteField category="hub" label="Cubo traseiro" value={bike.hub_rear} onChange={(v) => update({ hub_rear: v })} placeholder="DT Swiss 350, I9 Hydra..." />
        <InputField label="Raios" value={bike.spokes} onChange={(v) => update({ spokes: v })} placeholder="32H J-bend, 28H straight pull" />

        <SubLabel>Pneus</SubLabel>
        <AutocompleteField
          category="tyre" label="Pneu dianteiro" value={bike.tyre_model_front}
          onChange={(v) => update({ tyre_model_front: v })} placeholder="Maxxis Minion DHF 2.5"
          onSpecsReceived={(specs) => {
            if (specs.width_mm) update({ tyre_width_mm: specs.width_mm as number });
            if (specs.tubeless !== undefined) update({ tubeless: specs.tubeless as boolean });
          }}
        />
        <AutocompleteField
          category="tyre" label="Pneu traseiro" value={bike.tyre_model_rear}
          onChange={(v) => update({ tyre_model_rear: v })} placeholder="Maxxis Dissector 2.4"
        />
        <NumField label="Largura do pneu (mm)" value={bike.tyre_width_mm} onChange={(v) => update({ tyre_width_mm: v })} />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <NumField label="Pressão frente (PSI)" value={bike.tyre_pressure_front_psi} onChange={(v) => update({ tyre_pressure_front_psi: v })} step={0.5} />
          <NumField label="Pressão trás (PSI)" value={bike.tyre_pressure_rear_psi} onChange={(v) => update({ tyre_pressure_rear_psi: v })} step={0.5} />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <ToggleChip label="Tubeless" active={bike.tubeless} onChange={(v) => update({ tubeless: v })} />
          <ToggleChip label="Inserto" active={bike.tyre_insert} onChange={(v) => update({ tyre_insert: v })} />
        </div>
      </Card>

      {/* ── Section: Brakes ──────────────────────────────── */}
      <SectionHeader icon="do_not_disturb_on" color="#ff716c" label="Travões" />
      <Card>
        <div style={{ marginBottom: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Tipo</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {([
              { v: 'disc_hydraulic' as BrakeType, l: 'Disco hidráulico' },
              { v: 'disc_mechanical' as BrakeType, l: 'Disco mecânico' },
              { v: 'rim' as BrakeType, l: 'V-brake / Caliper' },
            ]).map((bt) => (
              <ChipButton key={bt.v} active={bike.brake_type === bt.v} color="#ff716c" onClick={() => update({ brake_type: bt.v })}>
                {bt.l}
              </ChipButton>
            ))}
          </div>
        </div>
        <AutocompleteField
          category="brake" label="Modelo" value={bike.brake_model}
          onChange={(v) => update({ brake_model: v })} placeholder="Shimano XT M8120 4-piston"
          onSpecsReceived={(specs) => {
            if (specs.type === 'hydraulic') update({ brake_type: 'disc_hydraulic' });
            if (specs.type === 'mechanical') update({ brake_type: 'disc_mechanical' });
          }}
        />
        {(bike.brake_type === 'disc_hydraulic' || bike.brake_type === 'disc_mechanical') && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <NumField label="Disco frente (mm)" value={bike.rotor_front_mm} onChange={(v) => update({ rotor_front_mm: v })} />
            <NumField label="Disco trás (mm)" value={bike.rotor_rear_mm} onChange={(v) => update({ rotor_rear_mm: v })} />
          </div>
        )}
      </Card>

      {/* ── Section: Cockpit ─────────────────────────────── */}
      <SectionHeader icon="sports_bar" color="#adaaaa" label="Cockpit" />
      <Card>
        <div style={{ marginBottom: '4px' }}>
          <div style={{ fontSize: '10px', color: '#777575', marginBottom: '4px' }}>Guiador</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {['flat', 'riser', 'drop', 'aero'].map((ht) => (
              <ChipButton key={ht} active={bike.handlebar_type === ht} color="#adaaaa" onClick={() => update({ handlebar_type: ht })}>
                {ht === 'flat' ? 'Flat' : ht === 'riser' ? 'Riser' : ht === 'drop' ? 'Drop' : 'Aero'}
              </ChipButton>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <NumField label="Largura guiador (mm)" value={bike.handlebar_width_mm} onChange={(v) => update({ handlebar_width_mm: v })} />
          <NumField label="Rise guiador (mm)" value={bike.handlebar_rise_mm} onChange={(v) => update({ handlebar_rise_mm: v })} />
          <NumField label="Comprimento avanço (mm)" value={bike.stem_length_mm} onChange={(v) => update({ stem_length_mm: v })} />
          <NumField label="Ângulo avanço (°)" value={bike.stem_angle_deg} onChange={(v) => update({ stem_angle_deg: v })} />
        </div>
        <AutocompleteField category="grips" label="Punhos / Fita" value={bike.grips_tape} onChange={(v) => update({ grips_tape: v })} placeholder="Ergon GE1, ESI Chunky..." />
        <AutocompleteField
          category="saddle" label="Selim" value={bike.saddle_model}
          onChange={(v) => update({ saddle_model: v })} placeholder="Fizik, Selle Italia, Giant..."
          onSpecsReceived={(specs) => {
            if (specs.width_mm) update({ saddle_width_mm: specs.width_mm as number });
          }}
        />
        <NumField label="Largura selim (mm)" value={bike.saddle_width_mm} onChange={(v) => update({ saddle_width_mm: v })} />
      </Card>

      {/* ── Section: Accessories (optional toggles) ────── */}
      <SectionHeader icon="backpack" color="#e966ff" label="Acessórios" />
      <Card>
        <ToggleChip label="Power Meter" active={bike.has_power_meter} onChange={(v) => update({ has_power_meter: v })} />
        {bike.has_power_meter && (
          <AutocompleteField category="power_meter" label="Modelo" value={bike.power_meter_model}
            onChange={(v) => update({ power_meter_model: v })} placeholder="Quarq DZero, Stages, Shimano..." />
        )}

        <ToggleChip label="Computador GPS" active={bike.has_gps_computer} onChange={(v) => update({ has_gps_computer: v })} />
        {bike.has_gps_computer && (
          <InputField label="Modelo" value={bike.gps_computer_model}
            onChange={(v) => update({ gps_computer_model: v })} placeholder="Garmin Edge 540, Wahoo ELEMNT..." />
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <ToggleChip label="Luzes" active={bike.has_lights} onChange={(v) => update({ has_lights: v })} />
          <ToggleChip label="Guarda-lamas" active={bike.has_mudguards} onChange={(v) => update({ has_mudguards: v })} />
          <ToggleChip label="Porta-bagagens" active={bike.has_rack} onChange={(v) => update({ has_rack: v })} />
        </div>
      </Card>

      {/* ── Section: E-Bike (motor/battery) ──────────────── */}
      {isEBike && (
        <>
          <SectionHeader icon="bolt" color="#3fff8b" label="Motor & Bateria" />
          <EBikeSection bike={bike} update={update} />
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// E-BIKE SECTION — motor telemetry + battery config
// ═══════════════════════════════════════════════════════════

function EBikeSection({ bike, update }: { bike: BikeConfig; update: (p: Partial<BikeConfig>) => void }) {
  const bat1 = useBikeStore((s) => s.battery_main_pct);
  const bat2 = useBikeStore((s) => s.battery_sub_pct);
  const motorOdo = useBikeStore((s) => s.motor_odo_km);
  const motorHours = useBikeStore((s) => s.motor_total_hours);
  const rangePerMode = useBikeStore((s) => s.range_per_mode);
  const fw = useBikeStore((s) => s.firmware_version);
  const hw = useBikeStore((s) => s.hardware_version);
  const sw = useBikeStore((s) => s.software_version);

  return (
    <>
      {/* Battery config */}
      <Card>
        <SubLabel>Bateria</SubLabel>
        <NumField label="Bateria principal (Wh)" value={bike.main_battery_wh} onChange={(v) => update({ main_battery_wh: v })} />
        <ToggleChip label="Range Extender" active={bike.has_range_extender} onChange={(v) => update({ has_range_extender: v })} />
        {bike.has_range_extender && (
          <NumField label="Range Extender (Wh)" value={bike.sub_battery_wh} onChange={(v) => update({ sub_battery_wh: v })} />
        )}
        <ReadOnlyRow label="Total" value={`${bike.main_battery_wh + (bike.has_range_extender ? bike.sub_battery_wh : 0)} Wh`} color="#3fff8b" />
        {bat1 > 0 && (
          <>
            <Divider />
            <ReadOnlyRow label="Main SOC (live)" value={`${bat1}%`} color={bat1 > 30 ? '#3fff8b' : '#fbbf24'} />
            {bat2 > 0 && <ReadOnlyRow label="Sub SOC (live)" value={`${bat2}%`} color={bat2 > 30 ? '#3fff8b' : '#fbbf24'} />}
          </>
        )}
      </Card>

      {/* Motor config */}
      <Card>
        <SubLabel>Motor</SubLabel>
        <AutocompleteField
          category="motor" label="Modelo do motor" value={bike.motor_name}
          onChange={(v) => update({ motor_name: v })} placeholder="SyncDrive Pro, Bosch CX..."
          onSpecsReceived={(specs) => {
            if (specs.torque_nm) update({ max_torque_nm: specs.torque_nm as number });
            if (specs.power_w) update({ max_power_w: specs.power_w as number });
          }}
        />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <NumField label="Torque max (Nm)" value={bike.max_torque_nm} onChange={(v) => update({ max_torque_nm: v })} />
          <NumField label="Potência max (W)" value={bike.max_power_w} onChange={(v) => update({ max_power_w: v })} />
        </div>
        <NumField label="Limite velocidade (km/h)" value={bike.speed_limit_kmh} onChange={(v) => update({ speed_limit_kmh: v })} />
        {motorOdo > 0 && <ReadOnlyRow label="Odómetro motor" value={`${motorOdo.toLocaleString()} km`} color="#6e9bff" />}
        {motorHours > 0 && <ReadOnlyRow label="Horas motor" value={`${motorHours} h`} />}
        {fw && <ReadOnlyRow label="Firmware" value={fw} />}
        {hw && <ReadOnlyRow label="Hardware" value={hw} />}
        {sw && <ReadOnlyRow label="Software" value={sw} />}
      </Card>

      {/* Range per mode (from motor telemetry) */}
      {rangePerMode && (
        <Card>
          <SubLabel>Autonomia por modo (do motor)</SubLabel>
          {(['eco', 'tour', 'active', 'sport', 'power', 'smart'] as const).map((mode) => {
            const range = (rangePerMode as Record<string, number>)[mode] ?? 0;
            if (range <= 0) return null;
            const colors: Record<string, string> = { eco: '#3fff8b', tour: '#6e9bff', active: '#fbbf24', sport: '#fbbf24', power: '#ff716c', smart: '#e966ff' };
            return <ReadOnlyRow key={mode} label={mode.toUpperCase()} value={`${range} km`} color={colors[mode]} />;
          })}
        </Card>
      )}

      {/* Consumption calibrated */}
      <Card>
        <SubLabel>Consumo calibrado (auto)</SubLabel>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <ReadOnlyRow label="ECO" value={`${bike.consumption_eco} Wh/km`} />
          <ReadOnlyRow label="TOUR" value={`${bike.consumption_tour} Wh/km`} />
          <ReadOnlyRow label="ACTIVE" value={`${bike.consumption_active} Wh/km`} />
          <ReadOnlyRow label="SPORT" value={`${bike.consumption_sport} Wh/km`} />
          <ReadOnlyRow label="POWER" value={`${bike.consumption_power} Wh/km`} />
        </div>
        <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px' }}>
          Valores auto-calibrados dos ranges do motor. Actualizam durante a volta.
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Shared UI components
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// AI BIKE SUMMARY — persisted, regenerates on spec changes
// ═══════════════════════════════════════════════════════════

/** Build a hash string from the key specs that affect the summary */
function bikeSpecsHash(bike: BikeConfig): string {
  return [
    bike.name, bike.bike_type, bike.category, bike.suspension,
    bike.frame_material, bike.fork_travel_mm, bike.rear_travel_mm,
    bike.wheel_size, bike.motor_name, bike.main_battery_wh,
    bike.weight_kg, bike.groupset_model, bike.brake_model,
    bike.fork_model, bike.rear_shock_model, bike.cassette_speeds,
    bike.drivetrain_type, bike.has_range_extender ? bike.sub_battery_wh : 0,
  ].join('|');
}

/** Build the spec string for the AI prompt */
function bikeSpecsText(bike: BikeConfig): string {
  const s: string[] = [];
  s.push(bike.name);
  if (bike.category) s.push(bikeCategoryLabel(bike.category));
  if (bike.suspension !== 'rigid') s.push(`${suspensionLabel(bike.suspension)} ${bike.fork_travel_mm}/${bike.rear_travel_mm}mm`);
  if (bike.bike_type === 'ebike' && bike.motor_name) s.push(`Motor: ${bike.motor_name} ${bike.main_battery_wh}${bike.has_range_extender ? `+${bike.sub_battery_wh}` : ''}Wh`);
  if (bike.weight_kg > 0) s.push(`${bike.weight_kg}kg`);
  if (bike.wheel_size) s.push(bike.wheel_size);
  if (bike.frame_material) s.push(bike.frame_material);
  if (bike.groupset_model) s.push(bike.groupset_model);
  if (bike.drivetrain_type) s.push(`${bike.drivetrain_type} ${bike.cassette_speeds}v`);
  if (bike.brake_model) s.push(`Travões: ${bike.brake_model}`);
  if (bike.fork_model) s.push(`Fork: ${bike.fork_model}`);
  if (bike.rear_shock_model) s.push(`Shock: ${bike.rear_shock_model}`);
  return s.join(', ');
}

function AiBikeSummary({ bike }: { bike: BikeConfig }) {
  const updateBikeConfig = useSettingsStore((s) => s.updateBikeConfig);
  const selectBike = useSettingsStore((s) => s.selectBike);
  const activeBikeId = useSettingsStore((s) => s.activeBikeId);
  const [loading, setLoading] = useState(false);

  const currentHash = bikeSpecsHash(bike);
  const needsRegen = bike.ai_summary_hash !== currentHash;
  const hasSummary = bike.ai_summary && bike.ai_summary.length > 10;
  const previousSummary = hasSummary ? bike.ai_summary : '';

  useEffect(() => {
    if (!needsRegen || loading) return;
    if (!bike.name || bike.name === 'default') return;

    const GEMINI_KEY = (import.meta.env.VITE_GEMINI_API_KEY ?? import.meta.env.VITE_GOOGLE_MAPS_API_KEY) as string | undefined;
    if (!GEMINI_KEY) return;

    const specsText = bikeSpecsText(bike);
    if (specsText.split(',').length < 3) return;

    // Build prompt — include previous summary for evolution tracking
    let prompt: string;
    if (previousSummary) {
      prompt = `Actualiza a descrição desta bicicleta em português (Portugal). A descrição anterior era:
"${previousSummary}"

As specs actuais são: ${specsText}

Escreve 2-3 frases: primeiro a descrição actual da bike (utilização ideal, pontos fortes, tipo de ciclista), depois se houve alguma mudança relevante face à descrição anterior, menciona a evolução (ex: "Upgrade de fork para Fox 38" ou "Mudou de grupo Deore para XT"). Se não houve mudanças significativas, não menciones evolução.

Responde APENAS com o texto, sem aspas.`;
    } else {
      prompt = `Descreve esta bicicleta em 2-3 frases em português (Portugal). Foca na utilização ideal, pontos fortes e para que tipo de ciclista é indicada. Sê directo e informativo.

Specs: ${specsText}

Responde APENAS com o texto, sem aspas.`;
    }

    setLoading(true);

    // Need to select this bike before updating
    const wasActive = activeBikeId;

    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 250 },
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
        if (text) {
          // Save to this bike's config
          if (activeBikeId !== bike.id) selectBike(bike.id);
          updateBikeConfig({ ai_summary: text, ai_summary_hash: currentHash });
          // Restore active bike if different
          if (wasActive !== bike.id) setTimeout(() => selectBike(wasActive), 50);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bike.id, needsRegen]);

  if (!hasSummary && !loading && !needsRegen) return null;

  return (
    <div style={{ marginTop: '6px', padding: '6px 8px', backgroundColor: 'rgba(233,102,255,0.04)', borderRadius: '4px', borderLeft: '2px solid rgba(233,102,255,0.2)' }}>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div className="w-3 h-3 border border-[#e966ff] border-t-transparent rounded-full animate-spin" />
          <span style={{ fontSize: '9px', color: '#777575' }}>{previousSummary ? 'AI a actualizar...' : 'AI a analisar...'}</span>
        </div>
      ) : hasSummary ? (
        <div style={{ fontSize: '10px', color: '#adaaaa', lineHeight: '1.4' }}>
          <span style={{ color: '#e966ff', fontWeight: 700, marginRight: '4px' }}>AI</span>
          {bike.ai_summary}
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// BIKE MODEL PICKER — load full bike specs from DB
// ═══════════════════════════════════════════════════════════

function BikeModelPicker({ bike, onApply }: { bike: BikeConfig; onApply: (specs: Record<string, unknown>) => void }) {
  const [frames, setFrames] = useState<BikeComponent[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [models, setModels] = useState<BikeComponent[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getTopComponents('frame', 300).then((data) => {
      setFrames(data);
      const brandMap = new Map<string, number>();
      data.forEach((c) => brandMap.set(c.brand, (brandMap.get(c.brand) ?? 0) + c.usage_count));
      setBrands([...brandMap.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b));

      // Detect current brand
      if (bike.brand) {
        const found = [...brandMap.keys()].find((b) => b.toLowerCase() === bike.brand.toLowerCase());
        if (found) {
          setSelectedBrand(found);
          setModels(data.filter((c) => c.brand === found));
        }
      }
      setLoaded(true);
    });
  }, [bike.brand]);

  const handleBrandChange = (brand: string) => {
    setSelectedBrand(brand);
    setModels(frames.filter((c) => c.brand === brand));
  };

  const handleModelSelect = (modelName: string) => {
    const comp = models.find((c) => c.model === modelName);
    if (!comp) return;
    const s = comp.specs as Record<string, unknown>;
    // Add weight_kg from weight_g
    if (comp.weight_g) s._weight_kg = comp.weight_g / 1000;
    // Update name to brand + model
    onApply(s);
    // Also update name, brand, model, year
    const { updateBikeConfig } = useSettingsStore.getState();
    updateBikeConfig({
      name: `${comp.brand} ${comp.model}`,
      brand: comp.brand,
      model: comp.model,
      year: comp.year_from ?? 0,
    });
  };

  if (!loaded) return null;

  return (
    <div style={{ padding: '10px 12px', backgroundColor: '#131313', borderRadius: '6px', border: '1px solid rgba(63,255,139,0.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#3fff8b' }}>auto_awesome</span>
        <span style={{ fontSize: '11px', color: '#3fff8b', fontWeight: 700 }}>Carregar modelo da base de dados</span>
        <span style={{ fontSize: '9px', color: '#494847', flex: 1, textAlign: 'right' }}>{frames.length} bikes</span>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <select value={selectedBrand} onChange={(e) => handleBrandChange(e.target.value)}
          style={{ flex: '0 0 35%', padding: '8px 24px 8px 8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: selectedBrand ? 'white' : '#777575', fontSize: '12px', outline: 'none', appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23777575\' stroke-width=\'1.5\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
          <option value="" disabled>Marca</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value="" onChange={(e) => handleModelSelect(e.target.value)} disabled={!selectedBrand}
          style={{ flex: 1, padding: '8px 24px 8px 8px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)', borderRadius: '4px', color: '#777575', fontSize: '11px', outline: 'none', opacity: selectedBrand ? 1 : 0.5, appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%23777575\' stroke-width=\'1.5\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
          <option value="" disabled>Escolher modelo → preenche tudo</option>
          {models.map((c) => {
            const s = c.specs as Record<string, unknown>;
            const tag = [
              s.suspension !== 'rigid' ? `${s.fork_travel_mm}/${s.rear_travel_mm}mm` : '',
              s.motor ? `${s.motor}` : '',
              c.weight_g ? `${(c.weight_g / 1000).toFixed(1)}kg` : '',
              c.year_from ? `${c.year_from}` : '',
            ].filter(Boolean).join(' · ');
            return <option key={c.id} value={c.model}>{c.model}{tag ? ` — ${tag}` : ''}</option>;
          })}
        </select>
      </div>
      <div style={{ fontSize: '9px', color: '#494847', marginTop: '4px' }}>
        Selecciona um modelo para carregar todas as specs. Podes editar tudo depois.
      </div>
    </div>
  );
}

function SectionHeader({ icon, color, label, count }: { icon: string; color: string; label: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '2px' }}>
      <span className="material-symbols-outlined" style={{ fontSize: '16px', color }}>{icon}</span>
      <span className="font-headline font-bold" style={{ fontSize: '12px', color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      {count !== undefined && <span style={{ fontSize: '10px', color: '#777575' }}>({count})</span>}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ backgroundColor: '#131313', padding: '12px', borderRadius: '6px', border: '1px solid rgba(73,72,71,0.15)', display: 'flex', flexDirection: 'column', gap: '6px' }}>{children}</div>;
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '10px', color: '#777575', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '4px' }}>{children}</div>;
}

function Divider() {
  return <div style={{ borderTop: '1px solid rgba(73,72,71,0.2)', margin: '4px 0' }} />;
}

function InputField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '8px 10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)',
          borderRadius: '4px', color: 'white', fontSize: '13px', outline: 'none',
        }}
      />
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: '#777575', marginBottom: '2px' }}>{label}</div>
      <input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        step={step ?? 1}
        style={{
          width: '100%', padding: '8px 10px', backgroundColor: '#0e0e0e', border: '1px solid rgba(73,72,71,0.3)',
          borderRadius: '4px', color: 'white', fontSize: '13px', outline: 'none',
        }}
      />
    </div>
  );
}

function ChipButton({ active, color, onClick, children }: { active: boolean; color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="active:scale-95 transition-all"
      style={{
        padding: '5px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
        border: active ? `1px solid ${color}40` : '1px solid transparent',
        backgroundColor: active ? `${color}20` : 'rgba(73,72,71,0.15)',
        color: active ? color : '#777575',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ToggleChip({ label, active, onChange }: { label: string; active: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!active)}
      className="active:scale-95 transition-all"
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '5px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
        backgroundColor: active ? 'rgba(63,255,139,0.15)' : 'rgba(73,72,71,0.15)',
        color: active ? '#3fff8b' : '#777575',
        border: active ? '1px solid rgba(63,255,139,0.3)' : '1px solid transparent',
        cursor: 'pointer',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{active ? 'check_circle' : 'radio_button_unchecked'}</span>
      {label}
    </button>
  );
}

function ReadOnlyRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#adaaaa', fontSize: '12px' }}>{label}</span>
      <span className="font-headline tabular-nums" style={{ color: color ?? 'white', fontSize: '12px', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
