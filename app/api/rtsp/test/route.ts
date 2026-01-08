import { NextRequest, NextResponse } from "next/server";
import net from "node:net";

export const runtime = "nodejs";

type RequestBody = {
  url?: string;
};

function parseStreamEndpoint(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname;
    if (!host) {
      return null;
    }
    const protocol = url.protocol.replace(":", "");
    const explicitPort =
      url.port && Number.parseInt(url.port, 10) > 0
        ? Number.parseInt(url.port, 10)
        : undefined;
    let port = explicitPort;
    if (!port || Number.isNaN(port)) {
      if (protocol === "http") {
        port = 80;
      } else if (protocol === "https") {
        port = 443;
      } else if (protocol === "rtsp") {
        port = 554;
      } else {
        port = 554;
      }
    }
    return { host, port };
  } catch {
    return null;
  }
}

function testTcpConnection(host: string, port: number, timeoutMs: number) {
  return new Promise<{ ok: boolean; message?: string; roundTripMs?: number }>(
    (resolve) => {
      const started = Date.now();
      const socket = net.createConnection({ host, port });
      let completed = false;

      const done = (result: {
        ok: boolean;
        message?: string;
        roundTripMs?: number;
      }) => {
        if (completed) return;
        completed = true;
        socket.destroy();
        resolve(result);
      };

      const timeout = setTimeout(() => {
        done({
          ok: false,
          message: "Timed out while connecting to stream endpoint.",
        });
      }, timeoutMs);

      socket.once("connect", () => {
        clearTimeout(timeout);
        done({
          ok: true,
          roundTripMs: Date.now() - started,
          message: "TCP port is reachable for the stream endpoint.",
        });
      });

      socket.once("error", (error) => {
        clearTimeout(timeout);
        done({
          ok: false,
          message:
            error && typeof error.message === "string"
              ? error.message
              : "Error while connecting to RTSP endpoint.",
        });
      });
    }
  );
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Request body must be valid JSON.",
      },
      { status: 400 }
    );
  }

  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json(
      {
        ok: false,
        message: "Field 'url' is required and must be a string.",
      },
      { status: 400 }
    );
  }

  const parsed = parseStreamEndpoint(body.url);
  if (!parsed) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Invalid URL. Expected a URL like protocol://host[:port]/path.",
      },
      { status: 400 }
    );
  }

  const result = await testTcpConnection(parsed.host, parsed.port, 5000);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: result.message,
        roundTripMs: result.roundTripMs,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: result.message,
      roundTripMs: result.roundTripMs,
    },
    { status: 200 }
  );
}
