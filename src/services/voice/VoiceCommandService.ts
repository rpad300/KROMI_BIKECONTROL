/**
 * VoiceCommandService — hands-free voice control via Web Speech API.
 *
 * Uses SpeechRecognition for continuous listening and SpeechSynthesis
 * for spoken feedback. Designed for use while riding (Portuguese default).
 * Chrome Android only (matches Web Bluetooth requirement).
 */

export interface VoiceCommand {
  patterns: string[];       // what the rider can say (lowercase)
  action: () => void;       // what happens
  feedback: string;         // spoken confirmation (empty = action handles speech)
}

class VoiceCommandService {
  private recognition: InstanceType<typeof SpeechRecognition> | null = null;
  private synthesis = window.speechSynthesis;
  private commands: VoiceCommand[] = [];
  private listening = false;
  private language = 'pt-PT';

  constructor() {
    const SR = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn('[Voice] SpeechRecognition not available');
      return;
    }

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = this.language;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1];
      if (last?.isFinal) {
        const transcript = last[0]!.transcript.toLowerCase().trim();
        console.log(`[Voice] Heard: "${transcript}"`);
        this.matchCommand(transcript);
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'no-speech' and 'aborted' are normal during riding — don't log as errors
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn(`[Voice] Error: ${event.error}`);
      }
    };

    this.recognition.onend = () => {
      // Auto-restart if still listening (recognition stops after silence)
      if (this.listening) {
        try { this.recognition?.start(); } catch { /* already started */ }
      }
    };
  }

  registerCommands(commands: VoiceCommand[]): void {
    this.commands = commands;
  }

  start(): void {
    if (!this.recognition) return;
    this.listening = true;
    try { this.recognition.start(); } catch { /* already started */ }
    console.log('[Voice] Listening...');
  }

  stop(): void {
    this.listening = false;
    try { this.recognition?.stop(); } catch { /* not started */ }
    console.log('[Voice] Stopped');
  }

  isListening(): boolean {
    return this.listening;
  }

  isAvailable(): boolean {
    return this.recognition !== null;
  }

  private matchCommand(transcript: string): void {
    for (const cmd of this.commands) {
      for (const pattern of cmd.patterns) {
        if (transcript.includes(pattern)) {
          console.log(`[Voice] Matched: "${pattern}" -> ${cmd.feedback || '(custom)'}`);
          cmd.action();
          if (cmd.feedback) {
            this.speak(cmd.feedback);
          }
          return;
        }
      }
    }
    console.log(`[Voice] No match for: "${transcript}"`);
  }

  speak(text: string): void {
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.language;
    utterance.rate = 1.2; // slightly faster for cycling
    utterance.volume = 1.0;
    this.synthesis.speak(utterance);
  }

  // ── Proactive announcements (called by engine/hooks) ──────

  announceGearSuggestion(_from: number, to: number, seconds: number): void {
    this.speak(`Muda para ${to}. Subida em ${seconds} segundos.`);
  }

  announceBatteryWarning(pct: number): void {
    this.speak(`Bateria a ${pct} porcento.`);
  }

  announceClimbLearned(_climbNumber: number): void {
    this.speak('Subida similar detectada. Assist ajustado.');
  }

  announceZoneBreach(zone: number, minutes: number): void {
    this.speak(`Atenção. Zona ${zone} em ${minutes} minutos. Reduz ritmo.`);
  }
}

export const voiceCommandService = new VoiceCommandService();
