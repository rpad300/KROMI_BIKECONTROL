import { useEffect, useRef } from 'react';
import { voiceCommandService, type VoiceCommand } from '../services/voice/VoiceCommandService';
import { useBikeStore } from '../store/bikeStore';
import { AssistMode } from '../types/bike.types';
import { kromiEngine } from '../services/intelligence/KromiEngine';

/**
 * useVoiceCommands — connects voice commands to app actions.
 *
 * Registers Portuguese voice commands for mode control, status queries,
 * nutrition logging, and emergency stop. Only active when `enabled` is true.
 */
export function useVoiceCommands(enabled: boolean) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !voiceCommandService.isAvailable()) {
      if (startedRef.current) {
        voiceCommandService.stop();
        startedRef.current = false;
      }
      return;
    }

    const setMode = (mode: AssistMode) => {
      useBikeStore.getState().setAssistMode(mode);
    };

    const commands: VoiceCommand[] = [
      // ── Mode commands (Portuguese) ──────────────────────────
      {
        patterns: ['modo eco', 'eco'],
        action: () => setMode(AssistMode.ECO),
        feedback: 'Modo eco ativado',
      },
      {
        patterns: ['modo tour', 'tour'],
        action: () => setMode(AssistMode.TOUR),
        feedback: 'Modo tour ativado',
      },
      {
        patterns: ['modo sport', 'sport', 'desporto'],
        action: () => setMode(AssistMode.SPORT),
        feedback: 'Modo sport ativado',
      },
      {
        patterns: ['modo power', 'power', 'máximo'],
        action: () => setMode(AssistMode.POWER),
        feedback: 'Modo power ativado',
      },
      {
        patterns: ['desligar motor', 'motor off'],
        action: () => setMode(AssistMode.OFF),
        feedback: 'Motor desligado',
      },

      // ── Status queries ──────────────────────────────────────
      {
        patterns: ['bateria', 'quanta bateria'],
        action: () => {
          const bat = useBikeStore.getState().battery_percent;
          voiceCommandService.speak(`Bateria a ${bat} porcento`);
        },
        feedback: '',
      },
      {
        patterns: ['velocidade', 'quanto vou'],
        action: () => {
          const speed = useBikeStore.getState().speed_kmh;
          voiceCommandService.speak(`${speed.toFixed(0)} quilómetros por hora`);
        },
        feedback: '',
      },
      {
        patterns: ['distância', 'quantos quilómetros'],
        action: () => {
          const dist = useBikeStore.getState().trip_distance_km;
          voiceCommandService.speak(`${(dist ?? 0).toFixed(1)} quilómetros`);
        },
        feedback: '',
      },

      // ── Nutrition ───────────────────────────────────────────
      {
        patterns: ['bebi água', 'água'],
        action: () => { kromiEngine.logWaterIntake(250); },
        feedback: 'Registado: 250 mililitros',
      },
      {
        patterns: ['comi', 'barra', 'gel'],
        action: () => { kromiEngine.logFoodIntake(25); },
        feedback: 'Registado: 25 gramas de carbos',
      },

      // ── Emergency ───────────────────────────────────────────
      {
        patterns: ['parar', 'stop', 'emergência'],
        action: () => setMode(AssistMode.OFF),
        feedback: 'Motor desarmado',
      },
    ];

    voiceCommandService.registerCommands(commands);
    voiceCommandService.start();
    startedRef.current = true;

    return () => {
      voiceCommandService.stop();
      startedRef.current = false;
    };
  }, [enabled]);

  return voiceCommandService;
}
