# ClipBridge — film spec

GOAL:    The viewer feels the small daily annoyance of moving things between a Mac and a PC, then the relief of
         just copying and pasting — and knows it's free, that pairing is one code, and both must share a Wi-Fi.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps.
TIME:    86.0 s x 30 = 2580 frames. Narration (ElevenLabs, George) starts at 0.5 s and is the clock: every beat
         starts on its anchor word (timings.json + 0.5 s). Music bed (ElevenLabs Music) 86.1 s, 100 BPM, groove
         opens at 22 s (the bridge).

LOOK:    Two worlds, one palette.
         - The desk (real world): wall #F3EFE8, desk top #E4D8C7 with a 2% fibre noise, soft daylight from upper
           left; contact shadows 0 18px 40px rgba(60,40,20,.18). During the "old way" (11.7–19.1 s) the desk world
           drops to 70% saturation and the light to 92% brightness; it returns to full at the bridge.
         - The product: the app's own light theme, quoted from src/renderer/style.css: ground #f5f5f8, surface
           #ffffff, border #e3e3eb, ink #191923, muted #676778, faint #9898a7, accent #5550d8, ok #16925a,
           star #e2a10b, warn #b87108, other-device colour #0e9f6e. Radius 12 px cards, 8 px controls.
         - Accent #5550d8 is rationed: the bridge stroke, the one highlighted word per shot, the end card button.
         - UI face: Segoe UI (local) 400/600/700 — what the app renders on Windows; covers Hebrew, Arabic, Cyrillic.
           Display face: Outfit 700, -2% tracking, titles 64–96 px; quiet labels 30–36 px Segoe UI 600.
         - Grain 2% on the desk world only. No vignette, no glow.
OBJECTS: - MacBook Air (left): silver aluminium lid #D6D8DC with a 1 px lighter edge, 14 px black bezel, rounded
           top corners 22 px, a camera notch, a wedge base #CACDD2 with a thumb scoop; macOS menu bar (time 9:41)
           and windows with red/amber/green dots.
         - PC (right): 27" monitor, black bezel #16171A 16 px, stand neck and oval foot #2A2C31; Windows taskbar at
           the bottom with centred icons and the time 9:41.
         - The link: one rounded chip holding `docs.company.com/q3-launch-final-v7` in Segoe UI 600, white on
           #191923 — the object that travels through the whole film.
         - The bridge: one 10 px accent (#5550d8) arc from the Mac's screen edge to the PC's, round caps.
         - Keycaps: white #FDFDFE caps, 4 px bottom edge #D3D4DA, 18 px radius, glyphs 54 px Segoe UI 600.
         - Cursor: macOS-style black arrow with white outline, 64 px tall (6% of frame height).
MOTION:  Arrivals expo.out 0.5–0.7 s; camera moves power2.inOut 0.8–1.2 s; exits power3.in 0.25 s; the chip
         travels along the bridge power2.inOut 0.9 s; UI state changes are instant clicks with a 4-frame press
         (scale 0.96). Staggers: list items 70 ms, letters typed 55 ms each. Titles land and hold dead still.
SHOTS:   (absolute seconds)
  S1  0.0–11.7  Desk. Slow 1.04→1.0 settle on the pair. "Mac" 3.08 the Mac screen wakes, "PC" 4.37 the PC wakes.
                "copy" 8.40 cursor selects the link, ⌘C keycaps pop on the Mac (click). "stuck" 10.30 the chip slides
                to the Mac's bezel and bumps (no sound). Hands off: the chip, carried into S2.
  S2  11.7–19.1 Detours, cut every ~2.3 s, desaturated: "email" 12.18 a mail draft to yourself, Send (click,
                whoosh); "Message" 13.50 a note-to-self chat bubble (pop); "type" 15.92 the PC retypes the link
                letter by letter (key ticks), "wrong" 18.33 the typo "lanch" gets a red underline. Hands off: the
                broken link fades back to the desk.
  S3  19.1–24.7 Desk returns to full colour. "clipboard" 20.16 the bridge draws itself screen to screen (0.9 s);
                "cross" 21.67 the chip rides across; "ClipBridge" 23.68 the arc's apex blooms into the app icon,
                wordmark wipes in (riser peaks 1 frame after). Music opens.
  S4  24.7–31.9 Close on both screens. "Copy" 24.92 ⌘C (click); "Paste" 26.13 Ctrl+V (click) and the link is in
                the PC's email; "already" 28.46 a "Copied from MacBook Air" hint; "other way" 30.37 a screenshot copied
                on the PC lands in a Mac note.
  S5  31.9–41.85 Real Settings UI at 1.7x. "code" 33.80 the code K7QM-4XRT-P9WE; "Type" 34.50 it is typed on the
                Mac (key ticks) → Apply (click) → "find" 36.72 status pill "Connected to Home-PC" (pop). "rule" 38.80
                pull back to both computers under one Wi-Fi mark; "same Wi-Fi" 40.40 label "Same Wi-Fi network".
  S6  41.85–52.9 Real History window at 1.8x. Items drop in from both devices (70 ms stagger) from 41.97; "no limit"
                47.30 the list runs; "Search" 48.16 "q3" typed, list filters; "star" 49.54 star fills (pop);
                "copy it again" 50.98 click → toast "Copied to clipboard ✓".
  S7  52.9–57.0 "Text" 53.06, "formatted" 54.18, "screenshots" 56.01: three real history cards land, the formatted one
                shown pasted with its bold heading intact, the screenshot as an image card.
  S8  57.0–67.6 Network world. "cloud" 58.50 a cloud above the two computers is crossed out and lifts away;
                "directly" 60.65 the bridge carries scrambled characters; "encrypted" 61.52 a lock seals the bridge;
                "password" 65.02 the real tray menu opens, "One click" 65.52 → "Pause sync (private mode)" checked
                (click), status turns "Paused".
  S9  67.6–72.9 The app's header, search and filters at 1.6x, switching language on each spoken name: English 68.24,
                Hebrew 68.97 (flips right-to-left), Spanish 69.74, French 70.19, Russian 71.10, Arabic 71.70 (RTL).
  S10 72.9–77.5 Back to the desk, warm. "stop" 73.20 the email/chat detours fly off; "copy" 75.72 ⌘C on the Mac,
                "paste" 76.82 Ctrl+V on the PC: the email gets its link and sends — the payoff, played at normal speed.
  S11 77.5–86.0 End card on #f5f5f8. The bridge collapses into the icon, carried in to centre (lockup 24% of width),
                wordmark wipes in; "Free" 79.43 "Free & open source · Mac & Windows"; CTA "Download free" +
                github.com/aiworldbyshachar/clipbridge held 3 s.
BANNED:  dark void grounds; glow, bloom, particles; purple/blue gradient grounds (the gradient lives only inside the
         real app icon); glass cards; three feature cards in a row; titles that drift after landing; every element
         fading and sliding up; the logo docked in a corner; invented product UI (every ClipBridge screen copies
         src/renderer); named competitor brands; "seamless", "effortless", "unlock".
QA:      frame 0 (desk, both computers, link visible); 10.3 (chip stuck at the bezel); 18.4 (typo underlined);
         23.9 (icon + wordmark); 26.4 (link pasted on PC); 37.0 (Connected pill); 40.6 (Same Wi-Fi label);
         49.7 (star filled); 59.0 (cloud crossed); 66.1 (Paused); 69.0 (Hebrew RTL); 71.8 (Arabic RTL);
         77.0 (email sent); 83.0 (end card with URL).
