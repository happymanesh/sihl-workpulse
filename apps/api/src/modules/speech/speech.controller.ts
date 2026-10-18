import {
  BadRequestException,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_AUDIO_BYTES, SpeechService } from "./speech.service";

/**
 * REST rather than tRPC, because this carries a file.
 *
 * tRPC serialises JSON; pushing audio through it would mean base64 in a JSON
 * body, inflating a recording by a third for no benefit. The browser sends the
 * blob as multipart and the rest of the app keeps its typed client.
 */
@Controller("speech")
export class SpeechController {
  constructor(private readonly speech: SpeechService) {}

  /** Lets the UI hide the microphone rather than offer a button that fails. */
  @Get("availability")
  availability() {
    return { available: this.speech.isConfigured };
  }

  @Post("transcribe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_AUDIO_BYTES } }))
  async transcribe(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("No recording was received");

    const result = await this.speech.transcribe({
      audio: file.buffer,
      contentType: file.mimetype || "audio/webm",
      fileName: file.originalname || "note.webm",
    });

    if (!result.text) {
      throw new BadRequestException(
        "Nothing could be made out in that recording. Try again somewhere quieter, or type the note.",
      );
    }

    return result;
  }
}
