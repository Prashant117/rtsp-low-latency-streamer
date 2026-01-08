import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const manualFfmpegPath = path.join(
  process.cwd(),
  "node_modules",
  "ffmpeg-static",
  "ffmpeg"
);
const ffmpegBinary = fs.existsSync(manualFfmpegPath)
  ? manualFfmpegPath
  : "ffmpeg";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing 'url' query parameter", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse(
      "Invalid URL. Expected protocol://host[:port]/path",
      { status: 400 }
    );
  }

  console.log(`[Stream] Starting MP4 stream for: ${url}`);

  const args: string[] = [
    ...(parsed.protocol === "rtsp:" ? ["-rtsp_transport", "tcp"] : []),
    "-i",
    url,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "24",
    "-keyint_min",
    "24",
    "-sc_threshold",
    "0",
    "-an",
    "-f",
    "mp4",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ];

  const ffmpegProcess = spawn(ffmpegBinary, args);

  ffmpegProcess.stderr.on("data", (data) => {
    console.log(`[FFmpeg STDERR] ${data}`);
  });

  ffmpegProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.log(`[Stream] FFmpeg exited with code ${code}`);
    }
  });

  const stream = new ReadableStream({
    start(controller) {
      ffmpegProcess.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(chunk);
      });
      ffmpegProcess.stdout.on("end", () => {
        controller.close();
      });
      ffmpegProcess.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      console.log(`[Stream] Client disconnected, killing FFmpeg process.`);
      ffmpegProcess.kill("SIGKILL");
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
    },
  });
}
