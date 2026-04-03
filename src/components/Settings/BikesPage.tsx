import { useState } from 'react';
import {
  useSettingsStore, safeBikeConfig,
  bikeCategoryLabel, suspensionLabel,
  type BikeConfig, type BikeCategory, type SuspensionType, type BrakeType,
  type DrivetrainType, type GroupsetBrand,
} from '../../store/settingsStore';
import { useBikeStore } from '../../store/bikeStore';
import { AutocompleteField } from '../shared/AutocompleteField';

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

  // Edit a specific bike
  const editBike = bikes.find((b) => b.id === editingId);
  if (editBike) {
    return <BikeDetailPage bike={safeBikeConfig(editBike)} onBack={() => setEditingId(null)} />;
  }

  return (
    <div className="space-y-3">
      <SectionHeader icon="pedal_bike" color="#3fff8b" label="As minhas bicicletas" count={bikes.length} />

      {/* Bike list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {bikes.map((b) => {
          const safe = safeBikeConfig(b);
          const isActive = b.id === activeBikeId;
          const catLabel = bikeCategoryLabel(safe.category);
          const susLabel = safe.suspension !== 'rigid' ? ` · ${suspensionLabel(safe.suspension)}` : '';
          const eLabel = safe.bike_type === 'ebike' ? ' · E-Bike' : '';

          return (
            <div
              key={b.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '12px',
                backgroundColor: isActive ? 'rgba(63,255,139,0.05)' : '#131313',
                borderLeft: `3px solid ${isActive ? '#3fff8b' : '#494847'}`,
                borderRadius: '4px',
              }}
            >
              {/* Bike info — click to edit */}
              <button
                onClick={() => setEditingId(b.id)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '28px', color: safe.bike_type === 'ebike' ? '#3fff8b' : '#6e9bff' }}>
                  {safe.bike_type === 'ebike' ? 'electric_bike' : 'pedal_bike'}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="font-headline font-bold" style={{ fontSize: '14px', color: 'white' }}>{safe.name}</div>
                  <div style={{ fontSize: '10px', color: '#777575', marginTop: '1px' }}>
                    {catLabel}{susLabel}{eLabel}
                    {safe.year > 0 ? ` · ${safe.year}` : ''}
                  </div>
                  {safe.brand && (
                    <div style={{ fontSize: '9px', color: '#494847', marginTop: '1px' }}>
                      {safe.brand} {safe.model} {safe.size ? `· ${safe.size}` : ''}
                    </div>
                  )}
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#494847' }}>chevron_right</span>
              </button>

              {/* Active toggle */}
              <button
                onClick={() => selectBike(b.id)}
                style={{
                  padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: '9px', fontWeight: 900,
                  backgroundColor: isActive ? '#3fff8b' : 'rgba(73,72,71,0.2)',
                  color: isActive ? 'black' : '#777575',
                  borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em',
                }}
              >
                {isActive ? 'Activa' : 'Activar'}
              </button>

              {/* Delete */}
              {bikes.length > 1 && (
                <button
                  onClick={() => { if (confirm(`Apagar ${safe.name}?`)) removeBike(b.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#ff716c' }}>delete</span>
                </button>
              )}
            </div>
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

function BikeDetailPage({ bike, onBack }: { bike: BikeConfig; onBack: () => void }) {
  const updateBikeConfig = useSettingsStore((s) => s.updateBikeConfig);
  const selectBike = useSettingsStore((s) => s.selectBike);
  const activeBikeId = useSettingsStore((s) => s.activeBikeId);

  // Ensure we're editing this bike
  if (activeBikeId !== bike.id) selectBike(bike.id);

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
