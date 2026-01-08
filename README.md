# Camera Streaming (RTSP/HTTP → Browser)

This project is a small, focused Next.js app for streaming IP camera feeds (RTSP or HTTP) into a web browser with minimal setup.

It:
- Accepts a camera URL (RTSP or HTTP) from the UI
- Tests basic TCP connectivity to the camera
- Uses ffmpeg on the server to pull the stream and transcode it to H.264
- Streams a fragmented MP4 over HTTP to a standard HTML `<video>` element

It is meant as a practical starting point for LAN camera monitoring, debugging IP cameras, or prototyping a streaming UI.

---

## Tech Stack

- **Framework**: Next.js 16.1.1 (App Router, Turbopack)
- **Runtime for APIs**: Node.js (Next.js `runtime = "nodejs"`)
- **Frontend**: React (App Router page in `app/page.tsx`)
- **Streaming backend**: ffmpeg (via `ffmpeg-static` + `child_process.spawn`)
- **Language**: TypeScript

---

## Project Structure (relevant files)

- `app/page.tsx`
  - Main UI page
  - Camera URL input
  - "Test connection" button
  - "Start stream" / "Stop stream" controls
  - `<video>` element that plays the stream

- `app/api/rtsp/test/route.ts`
  - POST endpoint: `/api/rtsp/test`
  - Validates URL
  - Performs a TCP connect test to host:port using Node `net`
  - Returns `{ ok, message, roundTripMs }`

- `app/api/stream/route.ts`
  - GET endpoint: `/api/stream?url=<encoded-camera-url>`
  - Spawns ffmpeg
  - Transcodes the camera stream to H.264 (`libx264`) fragmented MP4
  - Streams the MP4 to the browser as the response body

- `app/layout.tsx`
  - Global layout and metadata (title, favicon)

- `package.json`
  - Dependencies: `next`, `react`, `react-dom`, `ffmpeg-static`
  - Scripts: `dev`, `build`, `start`, `lint`

---

## Requirements

- **Node.js**: 18+ (Next.js 16 recommends modern Node; use the version you developed with)
- **ffmpeg**:
  - The app uses [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)
  - If `ffmpeg-static` cannot find a binary for your platform, you must have `ffmpeg` installed and available in `PATH`
- **Network access to the camera**:
  - The machine running this Next.js app must be able to reach the camera URL
  - For LAN cameras: run this app on the same LAN/VPN or a machine that can route to that LAN
- **Supported camera stream types**:
  - RTSP URLs (e.g. `rtsp://user:pass@192.168.0.10:554/stream1`)
  - HTTP video URLs (e.g. some IP webcams like `http://192.168.0.175:8080/video`)

---

## Getting Started

### 1. Install dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

### 2. Run the development server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

By default the app runs at: `http://localhost:3000`.

---

## Usage

1. Open `http://localhost:3000` in your browser.
2. In the **Camera stream URL** field, enter a camera URL, e.g.:
   - `rtsp://user:password@192.168.0.10:554/stream1`
   - `http://192.168.0.175:8080/video` (HTTP camera)
3. Click **Test connection**:
   - The app sends a POST to `/api/rtsp/test` with `{ url }`
   - The backend resolves the host/port and tries a TCP connection
   - UI shows:
     - Status: `Reachable` or `error`
     - RTT in milliseconds when successful
   - This test only checks basic reachability, not codec/stream correctness.
4. Click **Start stream**:
   - `isPlaying` is set to `true` and the `<video>` element’s `src` is set to `/api/stream?url=<encoded>`
   - `/api/stream` spawns ffmpeg to pull the camera stream and transcode it into H.264 fragmented MP4
   - The response body is streamed to the browser and played in the `<video>` element
5. Click **Stop stream**:
   - `isPlaying` is set to `false`
   - The `<video>` src is effectively removed (new key), and the browser closes the HTTP stream
   - The backend kills ffmpeg when the client disconnects

There is also a **Use sample RTSP URL** button, which fills in a default HTTP camera URL:

- `http://192.168.0.175:8080/video`

You should customize this to your own local camera or remove it before sharing the repo publicly if it’s sensitive.

---

## Streaming Implementation Details

### `/api/stream` – ffmpeg pipeline

The `GET /api/stream` endpoint:

1. Reads the `url` query parameter
2. Parses it as a `URL` and rejects invalid formats
3. Builds an ffmpeg argument list like:

```bash
# Pseudocode
ffmpeg \
  -rtsp_transport tcp (for rtsp:// URLs) \
  -i <camera-url> \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -pix_fmt yuv420p \
  -g 24 -keyint_min 24 -sc_threshold 0 \
  -an \
  -f mp4 \
  -movflags frag_keyframe+empty_moov+default_base_moof \
  pipe:1
```

4. Spawns ffmpeg using `child_process.spawn`
5. Wraps `ffmpegProcess.stdout` in a `ReadableStream` and uses it as the Next.js response body
6. Sets `Content-Type: video/mp4` and some basic no-cache headers

This pipeline ensures:

- Browser-compatible video format (H.264 in MP4)
- Fragmented MP4 suitable for streaming over HTTP
- Reasonable latency via `ultrafast` + `zerolatency` + short GOP

### `/api/rtsp/test` – connectivity check

The `POST /api/rtsp/test` endpoint:

1. Accepts JSON `{ url: string }`
2. Validates the URL (must be a valid URL with a hostname)
3. Extracts host and port; if no port is present, infers a default:
   - `rtsp` → port 554
   - `http` → port 80
   - `https` → port 443
4. Uses Node’s `net.createConnection` to open a TCP connection with a timeout
5. Responds with:
   - `200` and `{ ok: true, message, roundTripMs }` on success
   - `4xx/5xx` with `{ ok: false, message }` on errors

The frontend uses this result to display a human-readable status and RTT.

---

## UI / Frontend Behavior

The main UI in `app/page.tsx` handles:

- URL input and validation (using `new URL(...)`)
- Connection test button state (disabled until URL is valid)
- Start/stop stream buttons
- Displaying status, RTT, and connection messages
- A `<video>` element that:
  - Autoplays when `isPlaying` is `true`
  - Points to `/api/stream?url=<encoded>`
  - Shows browser-native controls

Because the streaming is done via a standard `<video src="...">`, you don’t need any client-side media libraries (no HLS.js, no MSE code). All heavy lifting is done server-side via ffmpeg.

---

## Configuration & Customization

### Changing the default sample URL

In `app/page.tsx`:

```ts
const rtspSampleUrl = "http://192.168.0.175:8080/video";
```

You can change this to any camera you use for testing, for example:

```ts
const rtspSampleUrl = "rtsp://user:password@192.168.0.10:554/Streaming/Channels/101";
```

### Adjusting ffmpeg tuning

In `app/api/stream/route.ts`, the ffmpeg flags can be tuned:

- **Latency vs quality**: change `-preset ultrafast` to `superfast`/`veryfast` for better quality at the cost of CPU and a bit more latency
- **GOP length** (`-g 24`): smaller value → more keyframes, potentially lower latency but higher bandwidth/CPU
- **Audio**: currently disabled via `-an`. To enable audio:
  - Remove `-an`
  - Add e.g. `-c:a aac -ar 44100 -ac 2`

Be aware that enabling audio often adds latency and complexity.

---

## Limitations

- **Not WebRTC**:
  - This is HTTP streaming, not real-time peer-to-peer media
  - Expect latency in the ~1–3 second range on a typical LAN, depending on camera and network
- **No audio (by default)**:
  - The current ffmpeg pipeline drops audio for simplicity
- **Browser buffering**:
  - The `<video>` element may buffer more than you’d like in some browsers; we do not aggressively override its behavior to avoid instability
- **Camera codec constraints**:
  - ffmpeg must be able to decode the camera’s stream
  - If the camera uses very unusual codecs or containers, you may need additional ffmpeg flags

If you need sub-second latency, this architecture is not ideal; consider:

- WebRTC-based solutions
- Specialized low-latency streaming servers

---

## Troubleshooting

### Video does not play at all

- Check the browser console for warnings like `Video playback error`.
- Check your dev server logs for `[FFmpeg STDERR] ...` output:
  - Connection errors: check camera URL, credentials, and network
  - Codec errors: the camera may use a codec that needs different ffmpeg flags
- Try the URL directly in VLC or `ffplay`:

  ```bash
  ffplay -rtsp_transport tcp <your-rtsp-url>
  ffplay <your-http-video-url>
  ```

If it doesn’t work in VLC/ffplay, ffmpeg in this app won’t be able to read it either.

### Test connection fails

- Verify camera IP and port
- Make sure the machine running this app is on the same network / VPN as the camera
- Check firewalls or router rules that might block RTSP or custom HTTP ports

### High latency

- Confirm that the Node server and camera are on the same LAN
- Reduce hops (avoid VPN or WAN where possible)
- You can experiment with:
  - Smaller GOP (`-g 12`), but watch for CPU and bandwidth
  - Different `preset` values

Remember: with standard HTTP + MP4 and `<video>`, some latency is inevitable; this app is optimized but not a hard real-time system.

---

## Development & Scripts

- `npm run dev` – start development server (Turbopack)
- `npm run build` – build for production
- `npm run start` – start production server
- `npm run lint` – run ESLint

---

## License

Add an appropriate license here (for example MIT) if you plan to publish this repository.