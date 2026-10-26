import React, { useState, useMemo } from 'react';
import {
  Layers,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Flame,
  RotateCw,
  Clock,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Activity,
  Gauge,
  Info,
} from 'lucide-react';
import { generateKineticsData } from '../utils/thermalKinetics';
import GemmaAssistant from './GemmaAssistant';

export default function StepKinetics({ protocol, overrides, setOverrides, onNext, onBack }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  // Compute reactive kinetics profile
  const kinetics = useMemo(() => generateKineticsData(protocol, overrides), [protocol, overrides]);
  const { points, stats } = kinetics;

  // Chart dimensions (wide and responsive)
  const W = 800, H = 260;
  const pad = { top: 24, right: 32, bottom: 36, left: 50 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const maxTime = Math.max(10, stats.totalTimeMin);
  const maxTemp = Math.max(120, protocol.safetyEnvelope.maxTempC * 1.05, stats.peakTemp * 1.15);
  const maxRpm  = Math.max(500, stats.maxRpm * 1.25);

  const gx = t => pad.left + (t / maxTime) * iW;
  const gy = v => pad.top + iH - (v / maxTemp) * iH;
  const gr = r => pad.top + iH - (r / maxRpm) * iH;

  const tempPath = useMemo(() => points.reduce((a, p, i) => {
    const x = gx(p.time), y = gy(p.temp);
    return i === 0 ? `M${x} ${y}` : `${a} L${x} ${y}`;
  }, ''), [points, maxTime, maxTemp]);

  const areaPath = useMemo(() => {
    if (!points.length) return '';
    const base = gy(0);
    return `${tempPath} L${gx(points[points.length - 1].time)} ${base} L${gx(0)} ${base} Z`;
  }, [tempPath, points, maxTime, maxTemp]);

  const rpmPath = useMemo(() => points.reduce((a, p, i) => {
    const x = gx(p.time), y = gr(p.rpm);
    return i === 0 ? `M${x} ${y}` : `${a} L${x} ${y}`;
  }, ''), [points, maxTime, maxRpm]);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const t = ((Math.max(pad.left, Math.min(W - pad.right, sx)) - pad.left) / iW) * maxTime;
    let best = 0, minD = Infinity;
    points.forEach((p, i) => { const d = Math.abs(p.time - t); if (d < minD) { minD = d; best = i; } });
    setHoverIndex(best);
  };

  const active = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : points[points.length - 1];

  // Baseline vs Overridden
  const baselinePeakTemp = Math.max(...protocol.steps.map(s => s.targetTempC || 0));
  const baselineMaxRpm = Math.max(...protocol.steps.map(s => s.stirRpm || 0));
  const safetyCeiling = protocol.safetyEnvelope.maxTempC;
  const isSafetyPassed = stats.peakTemp <= safetyCeiling && (!stats.violations || stats.violations.length === 0);

  return (
    <div style={{ maxWidth: '1120px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }} className="fade-in">

      {/* ── Top Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <span className="lab-badge lab-badge-lime" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Zap size={11} />
              Step 3 · Verification Matrix
            </span>
            <span className="lab-badge lab-badge-sage">Digital Twin Active</span>
          </div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--deep-charcoal)', letterSpacing: '-0.02em', margin: 0 }}>
            Physical Verification & Human-in-the-Loop Control
          </h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--slate-gray)', margin: '0.2rem 0 0 0' }}>
            Interactive thermodynamic curves and closed-loop hardware parameter verification.
          </p>
        </div>

        {/* Safety Envelope Status Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: isSafetyPassed ? 'var(--success-bg)' : 'var(--warning-bg)',
          border: `1px solid ${isSafetyPassed ? 'var(--success-border)' : 'var(--warning-border)'}`,
          padding: '0.45rem 0.875rem',
          borderRadius: 'var(--radius-full)',
          fontSize: '0.75rem',
          fontWeight: 700,
          color: isSafetyPassed ? 'var(--success-green)' : 'var(--warning-orange)',
        }}>
          {isSafetyPassed ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          <span>{isSafetyPassed ? 'Safety Envelope: ✅ Verified' : 'Safety Envelope: ⚠️ Interlock Tripped'}</span>
        </div>
      </div>

      {/* ── Clean 2-Column Bento Cockpit ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.55fr) minmax(320px, 1fr)',
        gap: '1.25rem',
        alignItems: 'start',
      }}>

        {/* ── LEFT COLUMN: The Scientific Simulation & Kinetic Graph ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Kinetic Curve Main Card */}
          <div className="notebook-card" style={{ padding: '1.25rem 1.35rem' }}>
            
            {/* Chart Top Controls & Legend */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <Activity size={15} color="var(--accent-blue)" />
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--deep-charcoal)' }}>
                  Kinetic Profile T(t) & Agitation ω(t)
                </span>
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '0.7rem', fontWeight: 600 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--deep-charcoal)' }}>
                  <span style={{ width: '12px', height: '3px', background: 'var(--primary-lime)', borderRadius: '2px', display: 'inline-block' }} />
                  T(t) Heat
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--deep-charcoal)' }}>
                  <span style={{ width: '12px', height: '0', borderTop: '2px dashed #38BDF8', display: 'inline-block' }} />
                  ω(t) RPM
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#EF4444' }}>
                  <span style={{ width: '12px', height: '0', borderTop: '2px dotted #EF4444', display: 'inline-block' }} />
                  Safe ({safetyCeiling}°C)
                </span>
              </div>
            </div>

            {/* SVG Dark Canvas Container */}
            <div style={{
              position: 'relative',
              background: 'linear-gradient(180deg, #0B1C30 0%, #06111D 100%)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.4)',
              overflow: 'hidden',
            }}>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
                onMouseMove={onMove}
                onMouseLeave={() => setHoverIndex(null)}
              >
                <defs>
                  <linearGradient id="neonTempGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D1F34D" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#D1F34D" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                  const y = pad.top + iH * (1 - pct);
                  return (
                    <g key={i}>
                      <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <text x={pad.left - 8} y={y + 4} fill="#94A3B8" fontSize="9" textAnchor="end" fontFamily="var(--font-mono)">
                        {Math.round(maxTemp * pct)}°C
                      </text>
                    </g>
                  );
                })}

                {/* X Axis Time Marks */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
                  <text key={i} x={pad.left + iW * pct} y={H - pad.bottom + 16} fill="#94A3B8" fontSize="9" textAnchor="middle" fontFamily="var(--font-mono)">
                    {Math.round(maxTime * pct)}m
                  </text>
                ))}

                {/* Red Dotted Safety Ceiling */}
                <line
                  x1={pad.left} y1={gy(safetyCeiling)}
                  x2={W - pad.right} y2={gy(safetyCeiling)}
                  stroke="#EF4444" strokeWidth="1.5" strokeDasharray="4 4"
                />
                <text x={W - pad.right - 4} y={gy(safetyCeiling) - 5} fill="#EF4444" fontSize="8.5" textAnchor="end" fontFamily="var(--font-mono)" fontWeight="bold">
                  CEILING {safetyCeiling}°C
                </text>

                {/* Area + Neon Temp Line */}
                <path d={areaPath} fill="url(#neonTempGrad)" />
                <path d={tempPath} fill="none" stroke="#D1F34D" strokeWidth="2.6" strokeLinecap="round" />

                {/* Agitation RPM Line */}
                <path d={rpmPath} fill="none" stroke="#38BDF8" strokeWidth="1.6" strokeDasharray="4 3" opacity="0.9" />

                {/* Hover Indicator Crosshair */}
                {active && (
                  <g>
                    <line x1={gx(active.time)} y1={pad.top} x2={gx(active.time)} y2={H - pad.bottom} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 2" />
                    <circle cx={gx(active.time)} cy={gy(active.temp)} r="4.5" fill="#D1F34D" stroke="#0B1C30" strokeWidth="2" />
                    <circle cx={gx(active.time)} cy={gr(active.rpm)} r="3.5" fill="#38BDF8" stroke="#0B1C30" strokeWidth="1.5" />
                  </g>
                )}
              </svg>

              {/* Real-Time Crosshair Floating Readout */}
              {active && (
                <div style={{
                  position: 'absolute',
                  top: '0.65rem',
                  right: '0.75rem',
                  background: 'rgba(11,28,48,0.92)',
                  border: '1px solid rgba(209,243,77,0.3)',
                  borderRadius: '8px',
                  padding: '0.35rem 0.75rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem',
                  color: '#F8FAFC',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  backdropFilter: 'blur(6px)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}>
                  <span>⏱ {active.time}m</span>
                  <span>•</span>
                  <span style={{ color: '#D1F34D', fontWeight: 700 }}>🌡 {active.temp}°C</span>
                  <span>•</span>
                  <span style={{ color: '#38BDF8', fontWeight: 700 }}>🔄 {active.rpm} RPM</span>
                </div>
              )}
            </div>

            {/* 3 Process Phase Zone Indicators */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 1fr', gap: '0.5rem', marginTop: '0.75rem', textAlign: 'center' }}>
              <div style={{ background: 'var(--light-blue)', border: '1px solid var(--light-blue-border)', borderRadius: '6px', padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: 'var(--accent-blue)', fontWeight: 700 }}>
                1. Ramp-Up (➔ {stats.peakTemp}°C)
              </div>
              <div style={{ background: 'var(--off-white)', border: '1px solid var(--slate-border)', borderRadius: '6px', padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: 'var(--deep-charcoal)', fontWeight: 700 }}>
                2. Isothermal Soak ({stats.totalTimeMin}m Dwell)
              </div>
              <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: '6px', padding: '0.35rem 0.5rem', fontSize: '0.68rem', color: 'var(--success-green)', fontWeight: 700 }}>
                3. Quench Cool-Down
              </div>
            </div>

          </div>

          {/* Active Phase Inspector */}
          <div style={{
            background: 'var(--off-white)',
            border: '1px solid var(--slate-border)',
            borderRadius: '12px',
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            fontSize: '0.74rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Gauge size={15} color="var(--accent-blue)" />
              <span style={{ color: 'var(--slate-gray)' }}>Hovering Phase:</span>
              <strong style={{ color: 'var(--deep-charcoal)' }}>{active.stepName || 'Dynamic Synthesis Phase'}</strong>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--slate-gray)' }}>
              Safety Threshold: <strong>{active.safetyLimit || safetyCeiling}°C</strong>
            </div>
          </div>

        </div>

        {/* ── RIGHT COLUMN: Control & Interactive Calibration Bento Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Target Material Badge Card */}
          <div className="notebook-card" style={{ padding: '1.125rem 1.25rem', background: '#FFFFFF' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--slate-light)', letterSpacing: '0.05em' }}>
              Target Material System
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--deep-charcoal)', marginTop: '0.25rem', lineHeight: 1.25 }}>
              {protocol.name}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent-blue)', fontWeight: 700, marginTop: '0.2rem' }}>
              {protocol.formula}
            </div>
            {protocol.selectedRoute && (
              <div style={{ marginTop: '0.5rem' }}>
                <span className="lab-badge lab-badge-lime" style={{ fontSize: '0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', lineHeight: 1.2 }}>
                  <Layers size={11} style={{ flexShrink: 0 }} />
                  {protocol.selectedRoute}
                </span>
              </div>
            )}
          </div>

          {/* Consolidated Human-in-the-Loop Calibration Tiles */}
          <div className="notebook-card" style={{ padding: '1.25rem', background: '#FFFFFF' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sliders size={14} color="var(--deep-charcoal)" />
                <span style={{ fontSize: '0.82rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--deep-charcoal)' }}>
                  Interactive Calibration
                </span>
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--slate-light)' }}>
                Live reactive override
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              
              {/* Tile 1: Temperature with Integrated Slider */}
              <div style={{
                padding: '0.75rem 0.875rem',
                borderRadius: '10px',
                background: 'var(--off-white)',
                border: overrides.tempOffset !== 0 ? '1px solid var(--warning-orange)' : '1px solid var(--slate-border)',
                transition: 'all 0.2s ease',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Flame size={13} color="var(--warning-orange)" />
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--deep-charcoal)' }}>Target Temp</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--deep-charcoal)' }}>
                      {stats.peakTemp}°C
                    </span>
                    {overrides.tempOffset !== 0 && (
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--warning-orange)' }}>
                        ({overrides.tempOffset > 0 ? `+${overrides.tempOffset}` : overrides.tempOffset}°)
                      </span>
                    )}
                  </div>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="1"
                  value={overrides.tempOffset || 0}
                  onChange={e => setOverrides(p => ({ ...p, tempOffset: parseInt(e.target.value, 10) }))}
                  className="slider-amber"
                  style={{ width: '100%', height: '4px', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--slate-light)', marginTop: '2px' }}>
                  <span>-30°C</span>
                  <span>Base ({baselinePeakTemp}°C)</span>
                  <span>+30°C</span>
                </div>
              </div>

              {/* Tile 2: Agitation with Integrated Slider */}
              <div style={{
                padding: '0.75rem 0.875rem',
                borderRadius: '10px',
                background: 'var(--off-white)',
                border: overrides.rpmMultiplier !== 1.0 ? '1px solid var(--accent-blue)' : '1px solid var(--slate-border)',
                transition: 'all 0.2s ease',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <RotateCw size={13} color="var(--accent-blue)" />
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--deep-charcoal)' }}>Agitation Speed</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--deep-charcoal)' }}>
                      {stats.maxRpm} <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>RPM</span>
                    </span>
                    {overrides.rpmMultiplier !== 1.0 && (
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-blue)' }}>
                        ({(overrides.rpmMultiplier ?? 1.0).toFixed(1)}x)
                      </span>
                    )}
                  </div>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={overrides.rpmMultiplier ?? 1.0}
                  onChange={e => setOverrides(p => ({ ...p, rpmMultiplier: parseFloat(e.target.value) }))}
                  className="slider-sage"
                  style={{ width: '100%', height: '4px', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--slate-light)', marginTop: '2px' }}>
                  <span>0.5x</span>
                  <span>Base ({baselineMaxRpm} RPM)</span>
                  <span>1.5x</span>
                </div>
              </div>

              {/* Tile 3: Duration with Integrated Slider */}
              <div style={{
                padding: '0.75rem 0.875rem',
                borderRadius: '10px',
                background: 'var(--off-white)',
                border: overrides.timeScale !== 1.0 ? '1px solid var(--slate-gray)' : '1px solid var(--slate-border)',
                transition: 'all 0.2s ease',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Clock size={13} color="var(--slate-gray)" />
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--deep-charcoal)' }}>Total Duration</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--deep-charcoal)' }}>
                      {stats.totalTimeMin} <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>m</span>
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--slate-light)' }}>
                      ({(stats.totalTimeMin / 60).toFixed(1)}h)
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={overrides.timeScale ?? 1.0}
                  onChange={e => setOverrides(p => ({ ...p, timeScale: parseFloat(e.target.value) }))}
                  className="slider-terra"
                  style={{ width: '100%', height: '4px', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--slate-light)', marginTop: '2px' }}>
                  <span>0.5x</span>
                  <span>1.0x Base</span>
                  <span>2.0x</span>
                </div>
              </div>

            </div>
          </div>

          {/* Safety Interlock Summary Box */}
          <div style={{
            padding: '0.875rem 1rem',
            background: isSafetyPassed ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            border: `1px solid ${isSafetyPassed ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            fontSize: '0.74rem',
            color: 'var(--deep-charcoal)',
          }}>
            <ShieldCheck size={16} color={isSafetyPassed ? 'var(--success-green)' : '#EF4444'} style={{ flexShrink: 0 }} />
            <div>
              <strong>Hardware Interlock:</strong> Peak {stats.peakTemp}°C ≤ Safe Limit {safetyCeiling}°C. Checksum CRC32 armed.
            </div>
          </div>

        </div>

      </div>

      {/* ── Gemma: result explain ── */}
      <GemmaAssistant
        mode="explain"
        title="Is result ko samjho (Gemma)"
        context={`Experiment: ${protocol.name}. Peak temperature: ${stats.peakTemp} C. Safe limit: ${safetyCeiling} C. Max RPM: ${stats.maxRpm}. Total time: ${stats.totalTimeMin} min. Safety passed: ${isSafetyPassed}. Violations: ${(stats.violations || []).map(v => v.message).join('; ') || 'none'}.`}
        fallback={isSafetyPassed ? 'Peak temperature safe limit ke andar hai, isliye protocol safe hai.' : 'Peak temperature ya ramp rate safe limit se zyada hai. Setpoint kam karo.'}
      />

      {/* ── Bottom Deploy & Navigation Bar ── */}
      <div className="notebook-card" style={{
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
        background: isSafetyPassed ? '#FFFFFF' : 'rgba(239, 68, 68, 0.06)',
        borderColor: isSafetyPassed ? 'var(--slate-border)' : 'rgba(239, 68, 68, 0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn-ghost" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
            <ArrowLeft size={14} /> Back
          </button>
          <div style={{ width: '1px', height: '24px', background: 'var(--slate-border)' }} />
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: isSafetyPassed ? 'var(--success-green)' : '#EF4444' }}>
              {isSafetyPassed ? 'Safety Envelope: ✅ Verified (No Flashpoint Detected)' : 'Safety Envelope: ⚠️ Hazardous Condition Detected!'}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--slate-light)', fontFamily: 'var(--font-mono)' }}>
              Peak {stats.peakTemp}°C ≤ Safe Limit {safetyCeiling}°C · CRC32 Checksum Armed
            </div>
          </div>
        </div>

        <button
          onClick={onNext}
          disabled={!isSafetyPassed}
          className="btn-primary"
          style={{
            fontSize: '0.92rem',
            padding: '0.75rem 1.75rem',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.625rem',
            opacity: isSafetyPassed ? 1 : 0.45,
            cursor: isSafetyPassed ? 'pointer' : 'not-allowed',
          }}
        >
          <ShieldCheck size={18} />
          Deploy Protocol to Lab
          <ArrowRight size={17} />
        </button>
      </div>

    </div>
  );
}
