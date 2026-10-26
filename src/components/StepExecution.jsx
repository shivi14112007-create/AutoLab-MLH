import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Layers,
  Cpu,
  FileText,
  Check,
  Clock,
  Hourglass,
  Thermometer,
  RotateCw,
  RotateCcw,
  Snowflake,
  Flame,
  Fan,
  Sun,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Square,
  AlertTriangle,
  Download,
  Code2,
  Sliders,
  CheckCircle2,
  ArrowLeft,
  Sparkles,
  SlidersHorizontal,
  X,
  Zap,
  Radio
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { generateKineticsData, generateHardwarePayload } from '../utils/thermalKinetics';
import GemmaAssistant from './GemmaAssistant';

export default function StepExecution({
  protocol,
  overrides = { tempOffset: 0, rpmMultiplier: 1.0, timeScale: 1.0 },
  isRunning,
  setIsRunning,
  logs = [],
  onAddLog,
  onBack,
  onResetAll,
  onOpenConnectLab,
}) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [simSpeed, setSimSpeed] = useState(10);
  const [simTemp, setSimTemp] = useState(25.0);
  const [simRpm, setSimRpm] = useState(0);
  const [heaterPwm, setHeaterPwm] = useState(0);
  const [isAborted, setIsAborted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [liveTempNudge, setLiveTempNudge] = useState(0);
  const [liveRpmNudge, setLiveRpmNudge] = useState(0);
  const [liveUvOverride, setLiveUvOverride] = useState(null);

  // Actuator hardware states
  const [heaterActive, setHeaterActive] = useState(true);
  const [manualHeaterTarget, setManualHeaterTarget] = useState(null);
  const [coolerActive, setCoolerActive] = useState(false);
  const [coolerIntensity, setCoolerIntensity] = useState(75);
  const [mixerActive, setMixerActive] = useState(true);
  const [manualMixerRpm, setManualMixerRpm] = useState(null);
  const [uvIntensity, setUvIntensity] = useState(80);

  // Modals & Collapsibles
  const [showPayloadModal, setShowPayloadModal] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showActuatorDrawer, setShowActuatorDrawer] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(new Date().toLocaleTimeString());
  const [reactorViewMode, setReactorViewMode] = useState('twin'); // 'twin' | 'rig'

  const terminalBoxRef = useRef(null);

  const kinetics = generateKineticsData(protocol, overrides);
  const totalSimSec = kinetics.stats.totalTimeMin * 60;
  const steps = protocol.steps || [];
  const activeStep = steps[currentStepIdx] || steps[0] || {};

  // Reset when protocol changes
  useEffect(() => {
    setCurrentStepIdx(0);
    setElapsedSec(0);
    setIsAborted(false);
    setIsPaused(false);
    setLiveTempNudge(0);
    setLiveRpmNudge(0);
    setLiveUvOverride(null);
    setManualHeaterTarget(null);
    setManualMixerRpm(null);
  }, [protocol?.id]);

  // Synchronize 4 actuators to active step
  useEffect(() => {
    if (manualHeaterTarget === null) {
      const isCool = activeStep?.operation === 'QUENCH_COOL' || 
                     activeStep?.operation === 'COOL_DOWN' || 
                     (activeStep?.name && (activeStep.name.toLowerCase().includes('quench') || activeStep.name.toLowerCase().includes('cool')));
      
      setCoolerActive(isCool);
      const effTemp = Math.round((activeStep?.targetTempC || 25) + (overrides.tempOffset || 0));
      setHeaterActive(!isCool && effTemp > 25);
    }
  }, [currentStepIdx, activeStep, manualHeaterTarget, overrides.tempOffset]);

  // Real-time targets
  const baseTargetTemp = Math.round((activeStep.targetTempC || 25) + (overrides.tempOffset || 0));
  const autoTargetTemp = Math.max(20, Math.min(protocol.safetyEnvelope?.maxTempC || 1200, baseTargetTemp + liveTempNudge));
  
  let targetTemp = autoTargetTemp;
  if (!heaterActive && !coolerActive) {
    targetTemp = 25.0;
  } else if (coolerActive) {
    targetTemp = Math.max(10, Math.round(25 - (coolerIntensity / 100) * 15));
  } else if (manualHeaterTarget !== null) {
    targetTemp = manualHeaterTarget;
  }

  const baseTargetRpm = Math.round((activeStep.stirRpm || 0) * (overrides.rpmMultiplier ?? 1));
  const autoTargetRpm = Math.max(0, Math.min(1500, baseTargetRpm + liveRpmNudge));
  
  let targetRpm = autoTargetRpm;
  if (!mixerActive) {
    targetRpm = 0;
  } else if (manualMixerRpm !== null) {
    targetRpm = manualMixerRpm;
  }

  const isUvActive = liveUvOverride !== null ? liveUvOverride : Boolean(activeStep.uvExposure);

  // Auto-scroll logs
  useEffect(() => {
    if (terminalBoxRef.current && showLogs) {
      terminalBoxRef.current.scrollTop = terminalBoxRef.current.scrollHeight;
    }
  }, [logs, showLogs]);

  // Main simulation telemetry loop
  useEffect(() => {
    let iv = null;
    if (isRunning && !isAborted && !isPaused) {
      iv = setInterval(() => {
        setElapsedSec(prev => {
          const next = prev + simSpeed * 0.5;
          if (next >= totalSimSec) {
            setIsRunning(false);
            onAddLog?.('EXPERIMENT_COMPLETE', `Protocol "${protocol.name}" completed successfully! All ${steps.length} hardware stages executed.`);
            try {
              confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors: ['#D1F34D', '#0058BE', '#22C55E'] });
            } catch (_) {}
            return totalSimSec;
          }
          return next;
        });

        // PID approach with micro-jitter
        setSimTemp(prev => {
          const d = targetTemp - prev;
          if (coolerActive) {
            return Math.round((prev + Math.sign(d) * Math.min(Math.abs(d), 3.8 * (simSpeed / 5))) * 10) / 10;
          }
          if (Math.abs(d) < 0.2) return targetTemp + (Math.random() - 0.5) * 0.3;
          return Math.round((prev + Math.sign(d) * Math.min(Math.abs(d), 2.2 * (simSpeed / 5))) * 10) / 10;
        });

        // RPM ramp
        setSimRpm(prev => {
          const d = targetRpm - prev;
          if (Math.abs(d) < 10) return targetRpm;
          return Math.round(prev + Math.sign(d) * Math.min(Math.abs(d), 80 * (simSpeed / 5)));
        });

        // Dynamic Heater PWM
        if (coolerActive) {
          setHeaterPwm(0);
        } else if (targetTemp > 25) {
          const err = targetTemp - simTemp;
          const pwm = Math.max(0, Math.min(100, Math.round(err * 12 + (targetTemp / 350) * 60)));
          setHeaterPwm(pwm);
        } else {
          setHeaterPwm(0);
        }

        setLastUpdateTime(new Date().toLocaleTimeString());
      }, 500);
    }
    return () => clearInterval(iv);
  }, [isRunning, isAborted, isPaused, targetTemp, targetRpm, simSpeed, totalSimSec, coolerActive, simTemp, protocol.name, steps.length, onAddLog, setIsRunning]);

  // Stage progress mapping
  const cumStepSec = [];
  let accum = 0;
  steps.forEach(st => {
    const sDur = Math.max(1, Math.round(st.durationMin * (overrides.timeScale || 1) * 60));
    accum += sDur;
    cumStepSec.push(accum);
  });

  useEffect(() => {
    if (isRunning && !isAborted && cumStepSec.length > 0) {
      let idx = 0;
      for (let i = 0; i < cumStepSec.length; i++) {
        if (elapsedSec < cumStepSec[i]) {
          idx = i;
          break;
        }
        if (i === cumStepSec.length - 1) idx = i;
      }
      if (idx !== currentStepIdx && idx < steps.length) {
        setCurrentStepIdx(idx);
        onAddLog?.('STAGE_TRANSITION', `Stage ${idx + 1}/${steps.length}: Transitioning to "${steps[idx].name}".`);
      }
    }
  }, [elapsedSec, isRunning, isAborted, cumStepSec, currentStepIdx, steps, onAddLog]);

  // Timing metrics
  const stepStartSec = currentStepIdx === 0 ? 0 : cumStepSec[currentStepIdx - 1];
  const stageDurationSec = Math.max(1, Math.round((activeStep.durationMin || 30) * (overrides.timeScale || 1) * 60));
  const stageElapsedSec = Math.max(0, Math.min(stageDurationSec, elapsedSec - stepStartSec));
  const stageProgressPct = Math.min(100, Math.round((stageElapsedSec / stageDurationSec) * 100));

  const remainingSec = Math.max(0, totalSimSec - elapsedSec);
  const elapsedH = Math.floor(elapsedSec / 3600);
  const elapsedM = Math.floor((elapsedSec % 3600) / 60);
  const elapsedStr = elapsedH > 0 ? `${elapsedH}h ${elapsedM}m` : `${Math.floor(elapsedSec / 60)}m ${String(Math.floor(elapsedSec % 60)).padStart(2, '0')}s`;

  const remH = Math.floor(remainingSec / 3600);
  const remM = Math.floor((remainingSec % 3600) / 60);
  const remStr = remH > 0 ? `${remH}h ${remM}m` : `${Math.floor(remainingSec / 60)}m ${String(Math.floor(remainingSec % 60)).padStart(2, '0')}s`;

  const progressPct = totalSimSec > 0 ? Math.min(100, Math.round((elapsedSec / totalSimSec) * 100)) : 0;

  // Fluid physics & animation dynamics
  const heatF = Math.min(1, Math.max(0, (simTemp - 25) / 180));
  const spinDur = simRpm > 0 ? Math.max(0.06, 60 / simRpm) : 0;
  const vortex = Math.min(28, (simRpm / 1000) * 28);

  let liquidColor = 'rgba(74, 116, 97, 0.65)';
  let liquidGlow = 'rgba(74, 116, 97, 0.25)';
  if (protocol.id?.includes('perovskite') || protocol.id?.includes('cspbbr3')) {
    if (simTemp > 140) {
      liquidColor = 'rgba(34, 197, 94, 0.85)';
      liquidGlow = 'rgba(34, 197, 94, 0.45)';
    } else {
      liquidColor = 'rgba(245, 158, 11, 0.7)';
      liquidGlow = 'rgba(245, 158, 11, 0.3)';
    }
  } else if (protocol.id?.includes('llzo')) {
    liquidColor = simTemp > 200 ? 'rgba(30, 41, 59, 0.9)' : simTemp > 70 ? 'rgba(245, 158, 11, 0.7)' : 'rgba(59, 130, 246, 0.55)';
    liquidGlow = 'rgba(59, 130, 246, 0.3)';
  } else if (protocol.id?.includes('fe3o4')) {
    liquidColor = simTemp > 60 ? 'rgba(15, 23, 42, 0.95)' : 'rgba(180, 83, 9, 0.75)';
    liquidGlow = 'rgba(180, 83, 9, 0.35)';
  } else if (simTemp > 100) {
    liquidColor = 'rgba(234, 88, 12, 0.8)';
    liquidGlow = 'rgba(234, 88, 12, 0.4)';
  } else if (simTemp > 50) {
    liquidColor = 'rgba(59, 130, 246, 0.65)';
    liquidGlow = 'rgba(59, 130, 246, 0.3)';
  }

  // Handlers
  const handleDeploy = () => {
    setIsAborted(false);
    setIsRunning(true);
    setIsPaused(false);
    onAddLog?.('EXPERIMENT_START', `Protocol "${protocol.name}" initiated at ${simSpeed}x hardware simulation speed.`);
  };

  const handleTogglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    onAddLog?.(next ? 'PAUSE' : 'RESUME', next ? `Execution paused at stage ${currentStepIdx + 1}.` : `Execution resumed.`);
  };

  const handleNextStage = () => {
    if (currentStepIdx < steps.length - 1) {
      const nextIdx = currentStepIdx + 1;
      setCurrentStepIdx(nextIdx);
      setElapsedSec(cumStepSec[currentStepIdx]);
      onAddLog?.('STAGE_ADVANCE', `Manual override: Advanced to Stage ${nextIdx + 1}: ${steps[nextIdx].name}.`);
    } else {
      setIsRunning(false);
      onAddLog?.('EXPERIMENT_COMPLETE', `Protocol "${protocol.name}" finished.`);
    }
  };

  const handlePrevStage = () => {
    if (currentStepIdx > 0) {
      const prevIdx = currentStepIdx - 1;
      setCurrentStepIdx(prevIdx);
      setElapsedSec(prevIdx === 0 ? 0 : cumStepSec[prevIdx - 1]);
      onAddLog?.('STAGE_REGRESS', `Manual override: Returned to Stage ${prevIdx + 1}: ${steps[prevIdx].name}.`);
    }
  };

  const handleEmergencyAbort = () => {
    setIsAborted(true);
    setIsRunning(false);
    setIsPaused(false);
    setMixerActive(false);
    setHeaterActive(false);
    setCoolerActive(false);
    setSimRpm(0);
    setHeaterPwm(0);
    onAddLog?.('EMERGENCY_HALT', `CRITICAL: Operator triggered safe stop. Heaters de-energized, motors halted.`);
  };

  const handleJumpToStage = (idx) => {
    if (idx >= 0 && idx < steps.length) {
      setCurrentStepIdx(idx);
      setElapsedSec(idx === 0 ? 0 : cumStepSec[idx - 1]);
      onAddLog?.('STAGE_JUMP', `Operator selected Stage ${idx + 1}: ${steps[idx].name}.`);
    }
  };

  const handleDownloadJson = () => {
    const payload = generateHardwarePayload(protocol, overrides);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autolab_${protocol.id || 'protocol'}_execution.json`;
    a.click();
    URL.revokeObjectURL(url);
    onAddLog?.('EXPORT', `Exported verified hardware execution bytecode payload.`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }} className="fade-in">

      {/* ═════════════════════════════════════════════════════════════════════════
          1. EXPERIMENT SUMMARY & TELEMETRY STRIP (Clean, Light, Single Card)
      ═════════════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: '14px',
        border: isAborted ? '1.5px solid #EF4444' : '1px solid #E5E9E4',
        padding: '1.15rem 1.75rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1.5rem',
        boxShadow: isAborted ? '0 0 20px rgba(239,68,68,0.1)' : '0 1px 3px rgba(0,0,0,0.02)'
      }}>
        {/* Left Segment: Material Identity & Live Operation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: '260px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '50%',
            background: isAborted ? '#FEE2E2' : '#F8FAFC',
            border: `1px solid ${isAborted ? '#FCA5A5' : '#E5E9E4'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>
            <Box size={22} color={isAborted ? '#DC2626' : '#0B1C30'} strokeWidth={1.8} />
          </div>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0B1C30', lineHeight: 1.2, display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              {protocol.name}
              {protocol.formula && (
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
                  {protocol.formula}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.84rem', color: '#64748B', marginTop: '0.2rem' }}>
              {isAborted ? <strong style={{ color: '#DC2626' }}>Emergency Halted</strong> : (isRunning ? (isPaused ? 'Paused' : activeStep.name) : 'Ready to Run')}
            </div>
          </div>
        </div>

        {/* Middle Segment: Stage Progress Bar */}
        <div style={{
          flex: 1,
          minWidth: '220px',
          maxWidth: '380px',
          borderLeft: '1px solid #E5E9E4',
          paddingLeft: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.45rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
            <span style={{ fontWeight: 700, color: '#0B1C30' }}>
              Stage {currentStepIdx + 1} of {steps.length}
            </span>
            <span style={{ color: '#64748B', fontWeight: 600 }}>
              {progressPct}%
            </span>
          </div>
          <div style={{ height: '6px', background: '#E5E9E4', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              width: `${progressPct}%`,
              height: '100%',
              background: isAborted ? '#EF4444' : '#D1F34D',
              borderRadius: '999px',
              transition: 'width 0.4s ease'
            }} />
          </div>
        </div>

        {/* Right Segment: Elapsed, Remaining & Speed Multiplier */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          borderLeft: '1px solid #E5E9E4',
          paddingLeft: '1.5rem',
          flexWrap: 'wrap'
        }}>
          {/* Elapsed */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <Clock size={18} color="#64748B" strokeWidth={1.8} />
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0B1C30', lineHeight: 1.1 }}>
                {elapsedStr}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748B' }}>elapsed</div>
            </div>
          </div>

          {/* Remaining */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <Hourglass size={18} color="#64748B" strokeWidth={1.8} />
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0B1C30', lineHeight: 1.1 }}>
                {remStr}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748B' }}>remaining</div>
            </div>
          </div>

          {/* Speed Pill */}
          <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', borderRadius: '8px', padding: '2px', border: '1px solid #E5E9E4' }}>
            <span style={{ fontSize: '0.68rem', color: '#64748B', padding: '0 0.45rem', fontWeight: 600 }}>Speed</span>
            {[1, 5, 10, 25].map(spd => (
              <button
                key={spd}
                onClick={() => setSimSpeed(spd)}
                style={{
                  border: 'none', padding: '0.2rem 0.5rem', borderRadius: '5px',
                  fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                  background: simSpeed === spd ? '#0B1C30' : 'transparent',
                  color: simSpeed === spd ? '#D1F34D' : '#64748B',
                  transition: 'all 0.15s ease'
                }}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════════
          2. FULL-WIDTH EXPERIMENT CONTROLS BAR (Prominent, High-Priority Top Deck)
      ═════════════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        border: '1px solid #E5E9E4',
        padding: '0.85rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1.25rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
      }}>
        {/* Left: Previous Stage Button */}
        <button
          onClick={handlePrevStage}
          disabled={currentStepIdx === 0}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0.4rem 0.65rem',
            cursor: currentStepIdx === 0 ? 'not-allowed' : 'pointer',
            opacity: currentStepIdx === 0 ? 0.35 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            textAlign: 'left'
          }}
        >
          <ChevronLeft size={18} color="#0B1C30" />
          <div>
            <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0B1C30' }}>
              Previous stage
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
              {steps[currentStepIdx - 1]?.name || 'Initial step'}
            </div>
          </div>
        </button>

        {/* Center: Playback Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {/* Pause / Resume Execution */}
          <button
            onClick={handleTogglePause}
            disabled={!isRunning || isAborted}
            style={{
              background: '#FFFFFF',
              border: '1px solid #E5E9E4',
              borderRadius: '8px',
              padding: '0.65rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#0B1C30',
              cursor: !isRunning || isAborted ? 'not-allowed' : 'pointer',
              opacity: !isRunning || isAborted ? 0.45 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            {isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} />}
            <span>{isPaused ? 'Resume execution' : 'Pause execution'}</span>
          </button>

          {/* Continue to next stage / Start synthesis */}
          {!isRunning || isAborted ? (
            <button
              onClick={handleDeploy}
              style={{
                background: '#D1F34D',
                color: '#0B1C30',
                border: 'none',
                borderRadius: '8px',
                padding: '0.65rem 1.6rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
              }}
            >
              <Play size={14} fill="currentColor" />
              <span>{isAborted ? 'Restart synthesis' : 'Start synthesis'}</span>
            </button>
          ) : (
            <button
              onClick={handleNextStage}
              style={{
                background: '#D1F34D',
                color: '#0B1C30',
                border: 'none',
                borderRadius: '8px',
                padding: '0.65rem 1.5rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
              }}
            >
              <span>{currentStepIdx >= steps.length - 1 ? 'Complete synthesis' : 'Continue to next stage'}</span>
              <ChevronRight size={15} />
            </button>
          )}

          {/* Stop Run */}
          <button
            onClick={handleEmergencyAbort}
            disabled={!isRunning && isAborted}
            style={{
              background: '#FFFFFF',
              color: '#DC4545',
              border: '1.5px solid #FCA5A5',
              borderRadius: '8px',
              padding: '0.65rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isAborted ? 'default' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              opacity: isAborted ? 0.6 : 1
            }}
          >
            <Square size={12} fill="#DC4545" color="#DC4545" />
            <span>{isAborted ? 'Stopped' : 'Stop run'}</span>
          </button>

          {/* Connect Lab / ESP Button */}
          <button
            type="button"
            onClick={onOpenConnectLab}
            style={{
              background: '#F8FAFC',
              border: '1px solid #CBD5E1',
              borderRadius: '8px',
              padding: '0.65rem 1rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#0B1C30',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
            }}
            title="Open ESP8266/ESP32 & Lab Server Gateway"
          >
            <Zap size={14} color="var(--accent-blue)" />
            <span>Connect Lab / ESP</span>
          </button>
        </div>

        {/* Right: Safety Notice */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', maxWidth: '240px', fontSize: '0.73rem', color: '#64748B', lineHeight: 1.35 }}>
          <AlertTriangle size={15} color="#D99A25" style={{ flexShrink: 0 }} />
          <span>Stopping will place actuators in their configured safe state.</span>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════════
          3. MAIN 3-COLUMN COCKPIT (Stages · Live Reactor · Equipment Status)
      ═════════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 28%) minmax(360px, 44%) minmax(280px, 28%)',
        gap: '16px',
        alignItems: 'stretch'
      }}>

        {/* ─────────────────────────────────────────────────────────────────
            COLUMN 1: PROCESS STAGES (Clean Vertical Connected Timeline)
        ───────────────────────────────────────────────────────────────── */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          border: '1px solid #E5E9E4',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '1rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0B1C30' }}>
                Process stages
              </div>
              <span style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 500 }}>
                {steps.length} Stages
              </span>
            </div>

            {/* Timeline */}
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              
              {/* Connecting vertical line */}
              <div style={{
                position: 'absolute',
                left: '14px',
                top: '16px',
                bottom: '24px',
                width: '1px',
                background: '#E5E9E4',
                zIndex: 0
              }} />

              {steps.map((st, idx) => {
                const isComplete = idx < currentStepIdx;
                const isActive = idx === currentStepIdx;

                return (
                  <div
                    key={st.id || idx}
                    onClick={() => handleJumpToStage(idx)}
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: isActive ? '0.65rem 0.75rem' : '0.45rem 0.65rem',
                      borderRadius: '10px',
                      background: isActive ? '#F2F8DF' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {/* Circle Node */}
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%',
                      background: isComplete ? '#FFFFFF' : (isActive ? '#D1F34D' : '#FFFFFF'),
                      border: isComplete ? 'none' : (isActive ? 'none' : '1px solid #CBD5E1'),
                      color: isComplete ? '#22A65A' : '#0B1C30',
                      fontSize: '0.72rem', fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {isComplete ? (
                        <div style={{
                          width: '20px', height: '20px', borderRadius: '50%',
                          background: 'rgba(34,166,90,0.12)', color: '#22A65A',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          <Check size={12} strokeWidth={3} />
                        </div>
                      ) : idx + 1}
                    </div>

                    {/* Stage Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: isActive ? 700 : 600, color: '#0B1C30' }}>
                          {st.name}
                        </span>
                        
                        {/* Status Label */}
                        {isComplete && (
                          <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#22A65A', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <CheckCircle2 size={13} fill="#22A65A" color="#FFFFFF" /> Complete
                          </span>
                        )}
                        {isActive && (
                          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#22A65A', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22A65A' }} /> Active
                          </span>
                        )}
                        {!isComplete && !isActive && (
                          <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                            {st.durationMin}m
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.15rem' }}>
                        {isComplete ? 'Step completed successfully' : (isActive ? `In progress · ${Math.floor(stageElapsedSec / 60)}m / ${st.durationMin}m` : `${st.targetTempC || 25}°C · ${st.stirRpm || 0} RPM`)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Literature Provenance */}
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', fontWeight: 600, color: '#0B1C30' }}>
              <Sparkles size={12} color="var(--accent-blue)" /> Literature Sourced
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', lineHeight: 1.3 }}>
              {protocol.citation?.title || protocol.name}
            </div>
            {protocol.citation?.doi && (
              <div style={{ fontSize: '0.68rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
                DOI: {protocol.citation.doi}
              </div>
            )}
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────────
            COLUMN 2: LIVE REACTOR (Visual Focal Point with Real Telemetry)
        ───────────────────────────────────────────────────────────────── */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          border: '1px solid #E5E9E4',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '1rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}>
          {/* Header: Title, Mode Switcher & Restrained State Pill */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0B1C30' }}>
                Live reactor
              </div>

              {/* View Toggle Pill */}
              <div style={{
                display: 'inline-flex',
                background: '#F1F5F9',
                borderRadius: '6px',
                padding: '2px',
                border: '1px solid #E2E8F0'
              }}>
                <button
                  type="button"
                  onClick={() => setReactorViewMode('twin')}
                  style={{
                    border: 'none',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: reactorViewMode === 'twin' ? '#0B1C30' : 'transparent',
                    color: reactorViewMode === 'twin' ? '#D1F34D' : '#64748B',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ⚗ Digital Twin
                </button>
                <button
                  type="button"
                  onClick={() => setReactorViewMode('rig')}
                  style={{
                    border: 'none',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: reactorViewMode === 'rig' ? '#0B1C30' : 'transparent',
                    color: reactorViewMode === 'rig' ? '#D1F34D' : '#64748B',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🔬 Lab Rig
                </button>
              </div>
            </div>

            {/* Status pill: Cooling, Heating, Stirring, or Idle */}
            {coolerActive ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '3px 8px', borderRadius: '6px',
                background: '#E0F2FE', color: '#0284C7',
                fontSize: '0.74rem', fontWeight: 600
              }}>
                <Snowflake size={12} />
                <span>Cooling</span>
              </div>
            ) : (heaterPwm > 0 && !coolerActive) ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '3px 8px', borderRadius: '6px',
                background: '#FEF2F2', color: '#DC2626',
                fontSize: '0.74rem', fontWeight: 600
              }}>
                <Flame size={12} />
                <span>Heating</span>
              </div>
            ) : simRpm > 0 ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '3px 8px', borderRadius: '6px',
                background: '#F2F8DF', color: '#65A30D',
                fontSize: '0.74rem', fontWeight: 600
              }}>
                <Fan size={12} />
                <span>Stirring</span>
              </div>
            ) : (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '3px 8px', borderRadius: '6px',
                background: '#F1F5F9', color: '#64748B',
                fontSize: '0.74rem', fontWeight: 600
              }}>
                <span>Idle</span>
              </div>
            )}
          </div>

          {/* Central Reactor Visualizer (Animated Digital Twin or Hardware Rig) */}
          {reactorViewMode === 'twin' ? (
            <div style={{
              position: 'relative',
              borderRadius: '12px',
              overflow: 'hidden',
              background: 'radial-gradient(ellipse at top, #1E293B 0%, #0F172A 100%)',
              border: '1px solid #334155',
              padding: '1.25rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '270px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)'
            }}>
              {/* Header Badges inside observation chamber */}
              <div style={{
                position: 'absolute',
                top: '10px',
                left: '12px',
                right: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                pointerEvents: 'none'
              }}>
                <span style={{ fontSize: '0.68rem', letterSpacing: '0.06em', color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>
                  OBSERVATION CHAMBER
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  {[
                    { label: 'Heat', active: heaterPwm > 0 && !isAborted && !coolerActive, color: '#EF4444' },
                    { label: 'Chill', active: coolerActive && !isAborted, color: '#38BDF8' },
                    { label: 'Stir', active: simRpm > 0 && !isAborted, color: '#D1F34D' },
                    { label: 'UV', active: isUvActive && !isAborted, color: '#A855F7' },
                  ].map(a => (
                    <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <div style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: a.active ? a.color : 'rgba(255,255,255,0.2)',
                        boxShadow: a.active ? `0 0 6px ${a.color}` : 'none'
                      }} />
                      <span style={{ fontSize: '0.66rem', color: a.active ? a.color : '#64748B', fontWeight: 600 }}>
                        {a.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Center Vessel Rig Assembly */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transform: 'translateX(-34px)',
                marginTop: '1.1rem'
              }}>
                {/* Top Condenser column */}
                <div style={{
                  width: '18px',
                  height: '24px',
                  background: 'linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,255,255,0.3), rgba(255,255,255,0.1))',
                  borderRadius: '3px 3px 0 0',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderBottom: 'none',
                  position: 'relative'
                }}>
                  <div style={{
                    position: 'absolute', top: '4px', left: '-6px', right: '-6px', height: '3px',
                    background: '#64748B', borderRadius: '2px'
                  }} />
                </div>

                {/* UV Optical Beam */}
                {isUvActive && !isAborted && (
                  <div style={{
                    width: '120px',
                    height: '8px',
                    background: 'linear-gradient(to right, transparent, rgba(168,85,247,0.7), transparent)',
                    borderRadius: '99px',
                    marginBottom: '4px',
                    animation: 'uvBeamPulse 1.3s ease-in-out infinite'
                  }} />
                )}

                {/* Central Glass Reactor Vessel */}
                <div style={{
                  width: '126px',
                  height: '154px',
                  background: `linear-gradient(180deg, rgba(255,255,255,0.08) 0%, ${liquidColor} 100%)`,
                  borderRadius: '8px 8px 40% 40% / 8px 8px 30% 30%',
                  border: `2px solid ${heaterPwm > 0 && !coolerActive && !isAborted ? '#EF4444' : (coolerActive && !isAborted ? '#38BDF8' : 'rgba(255,255,255,0.25)')}`,
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: heaterPwm > 0 && !coolerActive && !isAborted
                    ? '0 0 28px rgba(239,68,68,0.3)'
                    : (coolerActive && !isAborted ? '0 0 24px rgba(56,189,248,0.3)' : `0 0 20px ${liquidGlow}`),
                  transition: 'all 0.4s ease'
                }}>
                  {/* Fluid Column with dynamic height */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${55 + heatF * 20}%`,
                    background: `linear-gradient(to top, ${liquidColor}, ${liquidColor.replace(/[\d.]+\)$/, '0.35)')})`,
                    transition: 'height 0.4s ease',
                  }} />

                  {/* Stirring Vortex & Magnetic Stir Bar */}
                  {simRpm > 0 && !isAborted && (
                    <>
                      {/* Rotating Vortex Meniscus */}
                      <div style={{
                        position: 'absolute',
                        bottom: '22%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: `${vortex + 10}px`,
                        height: `${vortex + 10}px`,
                        pointerEvents: 'none'
                      }}>
                        <div style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: '50%',
                          border: '2px dashed rgba(209,243,77,0.75)',
                          animation: `vortexSpin ${spinDur}s linear infinite`
                        }} />
                      </div>

                      {/* Spinning Magnetic Stir Bar */}
                      <div style={{
                        position: 'absolute',
                        bottom: '16%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '36px',
                        height: '8px',
                        pointerEvents: 'none'
                      }}>
                        <div style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: '4px',
                          background: '#FFFFFF',
                          boxShadow: '0 0 10px rgba(255,255,255,0.9)',
                          animation: `vortexSpin ${spinDur}s linear infinite`
                        }} />
                      </div>

                      {/* Rising micro bubbles */}
                      <div style={{
                        position: 'absolute', bottom: '26%', left: '38%', width: '3px', height: '3px', borderRadius: '50%', background: 'rgba(255,255,255,0.6)',
                        animation: `thermalWaveUp ${spinDur * 2}s ease-in-out infinite`
                      }} />
                      <div style={{
                        position: 'absolute', bottom: '32%', right: '35%', width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(255,255,255,0.5)',
                        animation: `thermalWaveUp ${spinDur * 2.5}s ease-in-out infinite`
                      }} />
                    </>
                  )}

                  {/* Thermal convection waves */}
                  {heaterPwm > 0 && !coolerActive && !isAborted && targetTemp > 40 && (
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '100%',
                      display: 'flex',
                      justifyContent: 'space-around',
                      alignItems: 'flex-end',
                      paddingBottom: '8px',
                      pointerEvents: 'none'
                    }}>
                      {[0.9, 1.1, 1.3, 0.95, 1.15].map((d, i) => (
                        <div
                          key={i}
                          style={{
                            width: '3px',
                            height: '20px',
                            background: 'linear-gradient(to top, rgba(249,115,22,0.7), transparent)',
                            borderRadius: '2px',
                            animation: `thermalWaveUp ${d * 1.2}s ease-in-out infinite`
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Frost glimmer aura */}
                  {coolerActive && !isAborted && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(180deg, rgba(56,189,248,0.2) 0%, transparent 60%)',
                      animation: 'frostGlimmer 1.5s ease-in-out infinite'
                    }} />
                  )}
                </div>

                {/* Heated Stirrer Base Plate */}
                <div style={{
                  width: '148px',
                  height: '12px',
                  background: '#1E293B',
                  borderRadius: '0 0 8px 8px',
                  border: '1px solid #334155',
                  marginTop: '-1px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}>
                  <div style={{
                    width: '5px',
                    height: '5px',
                    borderRadius: '50%',
                    background: isRunning && !isAborted ? '#22C55E' : '#64748B',
                    boxShadow: isRunning && !isAborted ? '0 0 6px #22C55E' : 'none'
                  }} />
                </div>
              </div>

              {/* Callouts (Matches reference design) */}
              <div style={{
                position: 'absolute',
                right: '14px',
                top: '24%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.15rem',
                pointerEvents: 'none',
                zIndex: 4
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.72rem', color: '#E2E8F0', fontWeight: 500, background: 'rgba(15,23,42,0.92)', padding: '3px 8px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: heaterPwm > 0 ? '#EF4444' : '#64748B', boxShadow: heaterPwm > 0 ? '0 0 6px #EF4444' : 'none' }} />
                  <span>Furnace (PID: {heaterPwm}%)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.72rem', color: '#E2E8F0', fontWeight: 500, background: 'rgba(15,23,42,0.92)', padding: '3px 8px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E' }} />
                  <span>Reaction vessel</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.72rem', color: '#E2E8F0', fontWeight: 500, background: 'rgba(15,23,42,0.92)', padding: '3px 8px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: simRpm > 0 ? '#D1F34D' : '#64748B', boxShadow: simRpm > 0 ? '0 0 6px #D1F34D' : 'none' }} />
                  <span>Magnetic stirrer ({simRpm} RPM)</span>
                </div>
              </div>
            </div>
          ) : (
            /* Lab Rig View with Live Animated Overlays */
            <div style={{
              position: 'relative',
              borderRadius: '10px',
              overflow: 'hidden',
              background: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '260px'
            }}>
              {/* Photorealistic automated reactor station */}
              <img
                src="/lab_reactor_station.jpg"
                alt="Automated Reactor Station"
                style={{
                  width: '100%',
                  maxHeight: '270px',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />

              {/* Live Animated Flask Glow & Vortex Overlay on vessel area */}
              <div style={{
                position: 'absolute',
                left: '50.5%',
                top: '54%',
                transform: 'translate(-50%, -50%)',
                width: '74px',
                height: '74px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${liquidColor} 0%, transparent 70%)`,
                mixBlendMode: 'screen',
                pointerEvents: 'none'
              }} />

              {simRpm > 0 && !isAborted && (
                <div style={{
                  position: 'absolute',
                  left: '50.5%',
                  top: '54%',
                  transform: 'translate(-50%, -50%)',
                  width: `${Math.max(14, vortex)}px`,
                  height: `${Math.max(14, vortex)}px`,
                  borderRadius: '50%',
                  border: '1.5px dashed rgba(209,243,77,0.85)',
                  animation: `vortexSpin ${spinDur}s linear infinite`,
                  pointerEvents: 'none'
                }} />
              )}

              {/* Live LCD Telemetry Overlay on the rig screen */}
              <div style={{
                position: 'absolute',
                right: '23%',
                top: '41%',
                color: '#38BDF8',
                fontSize: '0.7rem',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                pointerEvents: 'none',
                textShadow: '0 0 4px #0284C7'
              }}>
                {simTemp.toFixed(0)}°C
              </div>

              {/* Callouts (Matches reference design) */}
              <div style={{
                position: 'absolute',
                right: '12px',
                top: '25%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                pointerEvents: 'none'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#475569', fontWeight: 500, background: 'rgba(255,255,255,0.9)', padding: '2px 6px', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: heaterPwm > 0 ? '#EF4444' : '#64748B' }} />
                  <span>Furnace (PID)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#475569', fontWeight: 500, background: 'rgba(255,255,255,0.9)', padding: '2px 6px', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22C55E' }} />
                  <span>Reaction vessel</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#475569', fontWeight: 500, background: 'rgba(255,255,255,0.9)', padding: '2px 6px', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: simRpm > 0 ? '#65A30D' : '#64748B' }} />
                  <span>Magnetic stirrer</span>
                </div>
              </div>
            </div>
          )}

          {/* Bottom 3 Live Telemetry Metrics */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            borderTop: '1px solid #E5E9E4',
            paddingTop: '0.85rem'
          }}>
            {/* Temperature */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.74rem' }}>
                <Thermometer size={14} />
                <span>Temperature</span>
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0B1C30', lineHeight: 1.15, marginTop: '2px' }}>
                {simTemp.toFixed(0)}°C
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Target: {targetTemp}°C
              </div>
            </div>

            {/* Stirring */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', borderLeft: '1px solid #E5E9E4', paddingLeft: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.74rem' }}>
                <RotateCw size={14} />
                <span>Stirring</span>
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0B1C30', lineHeight: 1.15, marginTop: '2px' }}>
                {simRpm} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#64748B' }}>RPM</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Target: {targetRpm} RPM
              </div>
            </div>

            {/* Stage time */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', borderLeft: '1px solid #E5E9E4', paddingLeft: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.74rem' }}>
                <Clock size={14} />
                <span>Stage time</span>
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0B1C30', lineHeight: 1.15, marginTop: '2px' }}>
                {Math.floor(stageElapsedSec / 60)}m {String(Math.floor(stageElapsedSec % 60)).padStart(2, '0')}s
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Total: {Math.floor(stageDurationSec / 60)}m ({stageProgressPct}%)
              </div>
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────────
            COLUMN 3: EQUIPMENT STATUS & INTEGRATED CONTROLS
        ───────────────────────────────────────────────────────────────── */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '12px',
          border: '1px solid #E5E9E4',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '1rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0B1C30' }}>
                Equipment status
              </div>
              <button
                onClick={() => {
                  setManualHeaterTarget(null);
                  setManualMixerRpm(null);
                  setHeaterActive(true);
                  setCoolerActive(false);
                  setLiveUvOverride(null);
                  onAddLog?.('SYSTEM', 'Actuator channels re-synchronized with recipe targets.');
                }}
                className="btn-ghost"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem' }}
                title="Sync actuators to recipe"
              >
                <RotateCcw size={11} style={{ marginRight: '4px' }} /> Sync Recipe
              </button>
            </div>

            {/* List of 4 Actuator rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              
              {/* Heater */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingBottom: '0.75rem', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Flame size={15} color="#64748B" />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0B1C30' }}>Heater</div>
                      <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>PID · Pin 5</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: heaterPwm > 0 && !coolerActive ? '#22A65A' : '#64748B', fontWeight: 600 }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: heaterPwm > 0 && !coolerActive ? '#22A65A' : '#94A3B8' }} />
                    <span>{heaterPwm > 0 && !coolerActive ? `Running · ${heaterPwm}%` : 'Off'}</span>
                  </div>
                </div>
                {/* Micro slider */}
                <input
                  type="range" min="20" max="350" step="5" value={targetTemp} disabled={coolerActive}
                  onChange={(e) => { const v = Number(e.target.value); setManualHeaterTarget(v); setHeaterActive(true); setCoolerActive(false); }}
                  style={{ width: '100%', accentColor: '#DC2626', height: '4px' }}
                />
              </div>

              {/* Chiller */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingBottom: '0.75rem', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Snowflake size={15} color="#64748B" />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0B1C30' }}>Chiller</div>
                      <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Peltier · Pin 12</div>
                    </div>
                  </div>
                  <button
                    onClick={() => { const next = !coolerActive; setCoolerActive(next); if (next) { setHeaterActive(false); setManualHeaterTarget(null); } }}
                    style={{ border: 'none', borderRadius: '5px', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', background: coolerActive ? '#0284C7' : '#E2E8F0', color: coolerActive ? '#FFFFFF' : '#64748B' }}
                  >
                    {coolerActive ? 'Quench On' : 'Idle'}
                  </button>
                </div>
                {/* Micro slider */}
                <input
                  type="range" min="20" max="100" step="5" value={coolerIntensity} disabled={!coolerActive}
                  onChange={(e) => setCoolerIntensity(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#0284C7', height: '4px' }}
                />
              </div>

              {/* Stirrer */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingBottom: '0.75rem', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Fan size={15} color="#64748B" />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0B1C30' }}>Stirrer</div>
                      <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>DC Motor · Pin 4</div>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.78rem', color: simRpm > 0 ? '#22A65A' : '#64748B', fontWeight: 600 }}>
                    {simRpm > 0 ? `${simRpm} RPM` : 'Off'}
                  </span>
                </div>
                {/* Micro slider */}
                <input
                  type="range" min="0" max="1400" step="50" value={targetRpm}
                  onChange={(e) => { const v = Number(e.target.value); setManualMixerRpm(v); setMixerActive(v > 0); }}
                  style={{ width: '100%', accentColor: '#D1F34D', height: '4px' }}
                />
              </div>

              {/* UV Photoreactor */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Sun size={15} color="#64748B" />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0B1C30' }}>UV lamp</div>
                      <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>365nm · Pin 16</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setLiveUvOverride(!isUvActive)}
                    style={{ border: 'none', borderRadius: '5px', padding: '2px 8px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', background: isUvActive ? '#7C3AED' : '#E2E8F0', color: isUvActive ? '#FFFFFF' : '#64748B' }}
                  >
                    {isUvActive ? 'Beam On' : 'Off'}
                  </button>
                </div>
                {/* Micro slider */}
                <input
                  type="range" min="10" max="100" step="5" value={uvIntensity} disabled={!isUvActive}
                  onChange={(e) => setUvIntensity(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#7C3AED', height: '4px' }}
                />
              </div>

            </div>
          </div>

          {/* Bottom quick inspect links */}
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '0.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={onOpenConnectLab}
              style={{
                background: '#F1F5F9',
                border: '1px solid #E2E8F0',
                borderRadius: '6px',
                padding: '3px 8px',
                fontSize: '0.72rem',
                color: '#0B1C30',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Cpu size={12} color="var(--accent-blue)" /> Connect ESP & Lab
            </button>
            <button
              onClick={() => setShowPayloadModal(true)}
              style={{ background: 'none', border: 'none', fontSize: '0.72rem', color: '#3B82A0', cursor: 'pointer', fontWeight: 600 }}
            >
              Inspect Bytecode →
            </button>
          </div>
        </div>

      </div>

      {/* ═════════════════════════════════════════════════════════════════════════
          4. LIVE HARDWARE LOG (Compact Collapsible Bar)
      ═════════════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        border: '1px solid #E5E9E4',
        padding: '0.75rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
      }}>
        {/* Header Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            onClick={() => setShowLogs(!showLogs)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}
          >
            {showLogs ? <ChevronDown size={15} color="#64748B" /> : <ChevronRight size={15} color="#64748B" />}
            <FileText size={15} color="#0B1C30" />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0B1C30' }}>
              Live hardware log
            </span>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>·</span>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>ESP8266 / COM3</span>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>·</span>
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, padding: '1px 6px', borderRadius: '4px',
              background: 'rgba(34,166,90,0.12)', color: '#22A65A', display: 'inline-flex', alignItems: 'center', gap: '0.25rem'
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22A65A' }} /> Connected
            </span>
          </div>

          <button
            onClick={() => setShowLogs(!showLogs)}
            style={{ background: 'none', border: 'none', fontSize: '0.78rem', color: '#64748B', fontWeight: 500, cursor: 'pointer' }}
          >
            {showLogs ? 'Hide events' : 'View recent events →'}
          </button>
        </div>

        {/* Expanded Hardware Log Terminal */}
        {showLogs && (
          <div style={{ borderTop: '1px solid #E5E9E4', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div
              ref={terminalBoxRef}
              style={{
                height: '140px',
                overflowY: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                lineHeight: 1.6,
                color: '#A7F3D0',
                background: '#0F172A',
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem'
              }}
            >
              {logs?.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.55rem' }}>
                  <span style={{ color: '#475569', flexShrink: 0 }}>[{l.timestamp}]</span>
                  <span style={{ color: '#38BDF8', flexShrink: 0, fontWeight: 700 }}>[{l.tag}]</span>
                  <span style={{ color: '#E2E8F0' }}>{l.message}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button
                onClick={() => setShowPayloadModal(true)}
                style={{
                  background: '#F8FAFC', border: '1px solid #E5E9E4', borderRadius: '6px',
                  padding: '0.35rem 0.65rem', fontSize: '0.74rem', color: '#0B1C30', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600
                }}
              >
                <Code2 size={13} /> Bytecode JSON
              </button>
              <button
                onClick={handleDownloadJson}
                style={{
                  background: '#F8FAFC', border: '1px solid #E5E9E4', borderRadius: '6px',
                  padding: '0.35rem 0.65rem', fontSize: '0.74rem', color: '#0B1C30', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600
                }}
              >
                <Download size={13} /> Download JSON
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 5. Bottom Navigation & Footer ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid #E5E9E4' }}>
        <button
          className="btn-ghost"
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', fontWeight: 600 }}
        >
          <ArrowLeft size={15} /> Back to Verify Kinetics
        </button>

        <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
          Last update {lastUpdateTime} · AutoLab OS v2.4 (Scientific Edition)
        </span>

        <button
          className="btn-ink"
          onClick={onResetAll}
          style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.85rem', fontWeight: 600 }}
        >
          <RotateCw size={14} /> Synthesize Another Material
        </button>
      </div>

      {/* Gemma: hint ladder */}
      <GemmaAssistant
        mode="hint"
        title="Hint chahiye? (Gemma)"
        context={`Experiment: ${protocol.name}. Current stage ${currentStepIdx + 1} of ${steps.length}: ${activeStep.name || 'n/a'} (${activeStep.operation || 'n/a'}). Target temperature: ${targetTemp} C. Live temperature: ${Number(simTemp).toFixed(1)} C. Target RPM: ${targetRpm}. Safe limit: ${protocol.safetyEnvelope?.maxTempC} C. Aborted: ${isAborted}. Paused: ${isPaused}.`}
        fallback="Pehle dekho ki current stage ka target temperature aur RPM protocol ke hisaab se hai ya nahi."
      />

      {/* ═════════════════════════════════════════════════════════════════════════
          JSON PAYLOAD MODAL
      ═════════════════════════════════════════════════════════════════════════ */}
      {showPayloadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,28,48,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: '1.25rem' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '16px', maxWidth: '640px', width: '100%', padding: '1.5rem', position: 'relative', border: '1px solid #E5E9E4', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Code2 size={17} color="#0B1C30" />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#0B1C30' }}>CRC32-Verified Machine Bytecode</h3>
              </div>
              <button onClick={() => setShowPayloadModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
            <pre style={{ background: '#0F172A', color: '#A7F3D0', padding: '1.25rem', borderRadius: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', overflowX: 'auto', maxHeight: '350px' }}>
              {JSON.stringify(generateHardwarePayload(protocol, overrides), null, 2)}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button
                onClick={handleDownloadJson}
                style={{ background: '#0B1C30', color: '#FFFFFF', border: 'none', borderRadius: '8px', padding: '0.55rem 1.25rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Download size={14} /> Download autolab_{protocol.id || 'protocol'}.json
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
