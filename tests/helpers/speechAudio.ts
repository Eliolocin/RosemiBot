import ffmpegPath from "ffmpeg-static";
export function createSpeechWav(durationSeconds = 0.2): Buffer {
  const sampleRate = 24_000;
  const samples = Math.floor(sampleRate * durationSeconds);
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(sampleRate, 24);
  audio.writeUInt32LE(sampleRate * 2, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    audio.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / sampleRate) * 5_000), 44 + i * 2);
  return audio;
}

export async function createSpeechMp3(): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("Missing bundled audio converter");
  const proc = Bun.spawn([ffmpegPath, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "mp3", "pipe:1"], {
    stdin: new Blob([new Uint8Array(createSpeechWav())]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const audio = Buffer.from(await new Response(proc.stdout).arrayBuffer());
  if ((await proc.exited) !== 0) throw new Error("Audio fixture conversion failed");
  return audio;
}
