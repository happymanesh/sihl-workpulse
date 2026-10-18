import { Injectable, Logger, PayloadTooLargeException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface TranscriptionResult {
  text: string;
  languageCode: string | null;
}

/** Audio longer than this is refused before it reaches the provider. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/**
 * Dictation, via Sarvam AI.
 *
 * The same provider and endpoint SIHL-ONE uses, deliberately: an Indian
 * provider, so a recording of somebody discussing a named client stays with an
 * Indian company. Their speech-to-text-translate endpoint accepts the languages
 * SIHL's staff actually speak and returns English, which is what a reader
 * needs - a department head should be able to read every note without speaking
 * Gujarati.
 *
 * When no key is configured this REFUSES rather than returning empty text.
 * Silence is indistinguishable from "the service ate my note", and somebody who
 * just dictated a paragraph deserves to be told it went nowhere.
 */
@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  private warned = false;

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return (
      this.config.get<string>("SPEECH_PROVIDER") === "sarvam" &&
      Boolean(this.config.get<string>("SARVAM_API_KEY"))
    );
  }

  async transcribe(input: { audio: Buffer; contentType: string; fileName: string }): Promise<TranscriptionResult> {
    if (input.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new PayloadTooLargeException(
        "That recording is too long. Dictation is meant for short notes — record again, or type it.",
      );
    }

    if (!this.isConfigured) {
      if (!this.warned) {
        this.logger.warn(
          "Dictation is not configured. Set SPEECH_PROVIDER=sarvam and SARVAM_API_KEY to enable it.",
        );
        this.warned = true;
      }
      throw new ServiceUnavailableException("Dictation is not switched on. Type the note for now.");
    }

    const apiKey = this.config.get<string>("SARVAM_API_KEY")!;
    const model = this.config.get<string>("SARVAM_STT_MODEL") ?? "saaras:v3";
    const endpoint =
      this.config.get<string>("SARVAM_STT_URL") ?? "https://api.sarvam.ai/speech-to-text-translate";
    const timeoutMs = Number(this.config.get<string>("SPEECH_TIMEOUT_MS") ?? 45_000);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(input.audio)], { type: input.contentType }), input.fileName);
    form.append("model", model);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        // Sarvam's own header name, not an Authorization bearer.
        headers: { "api-subscription-key": apiKey },
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        // Their message names the unsupported format or the retired model, so
        // it is logged in full and summarised to the caller rather than lost.
        const detail = await response.text().catch(() => "");
        this.logger.warn(`Sarvam returned ${response.status}: ${detail.slice(0, 300)}`);
        throw new ServiceUnavailableException(
          response.status === 401 || response.status === 403
            ? "The speech service rejected our credentials. Type the note and tell an administrator."
            : "The speech service could not process that recording. Try again, or type the note.",
        );
      }

      const body = (await response.json()) as { transcript?: string; language_code?: string | null };
      return { text: (body.transcript ?? "").trim(), languageCode: body.language_code ?? null };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const reason = error instanceof Error ? error.message : "unknown";
      this.logger.warn(`Sarvam request failed: ${reason}`);
      throw new ServiceUnavailableException(
        reason.includes("abort") || reason.includes("timeout")
          ? "The speech service took too long. Try a shorter recording, or type the note."
          : "The speech service could not be reached. Type the note for now.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
