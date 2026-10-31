# MyClip AI

Type the edit. MyClip AI plans it, previews it, and only applies it when you say so.

## Run it

No install needed. Either open `index.html` in a browser, or serve the folder:

```bash
cd myclip-ai
python3 -m http.server 8080
```

Then open http://localhost:8080.

## What is here

- `index.html`: landing page
- `studio.html`: the studio (drop a file, type a command, apply or discard the plan, undo)
- `css/styles.css`: all styling
- `js/edits.js`: the edit model (command parsing, applied-change state, time formatting)
- `js/studio.js`: studio behaviour (file loading, preview, timeline, plans, undo, links)

## What is real and what is a stand-in

Real in this build:
- Loading a video, audio file or image, and previewing it
- The preview follows the applied cuts (playback stays inside the kept range), speed, mute, fade and reframe
- Apply, discard and undo, with the original file never changed

Stand-ins for the next step:
- **Command parsing** runs on the device with keyword matching (`js/edits.js`). The live version will send the sentence to Claude and get structured operations back.
- **Captions** show a placeholder line. Real captions need speech-to-text.
- **Sources** (GitHub, Google Drive, Dropbox, YouTube, links) are shown but not connected. They need a server with OAuth and API keys.
- **Export** is not built yet. The preview works; rendering the final file needs FFmpeg on a server.

## Next steps

1. Move to a full-stack setup (Next.js on Vercel, with Supabase for accounts and storage) once npm is reachable from your machine.
2. Add a server route that sends commands to Claude and returns operations.
3. Add GitHub sign-in and repo access.
4. Render the final file with FFmpeg on the server.
