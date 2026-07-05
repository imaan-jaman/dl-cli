#!/usr/bin/env node

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const cliProgress = require("cli-progress");

// ── ANSI ────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", white: "\x1b[37m", gray: "\x1b[90m",
  magenta: "\x1b[35m",
};
const clr = (code, t) => `${code}${t}${c.reset}`;

// ── Helpers ─────────────────────────────────────────────────────────
function fmtSize(b) {
  for (const u of ["B", "KB", "MB", "GB"]) {
    if (b < 1024) return `${b.toFixed(1)} ${u}`;
    b /= 1024;
  }
  return `${b.toFixed(1)} TB`;
}

function clear() {
  process.stdout.write(process.platform === "win32" ? "\x1Bc" : "\x1B[2J\x1B[H");
}

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

// ── Platform detection ──────────────────────────────────────────────
const PLATFORMS = [
  { name: "YouTube",      icon: "\u25B6",  color: c.red,    patterns: ["youtube.com", "youtu.be", "m.youtube.com"] },
  { name: "TikTok",       icon: "\u266B",  color: c.magenta, patterns: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
  { name: "Instagram",    icon: "\u25CF",  color: c.red,    patterns: ["instagram.com", "instagr.am"] },
  { name: "Twitter / X",  icon: "\u2709",  color: c.cyan,   patterns: ["twitter.com", "x.com", "t.co"] },
  { name: "Facebook",     icon: "\u25A0",  color: c.cyan,   patterns: ["facebook.com", "fb.com", "fb.watch"] },
  { name: "Twitch",       icon: "\u2588",  color: c.magenta, patterns: ["twitch.tv", "clips.twitch.tv"] },
  { name: "Reddit",       icon: "\u25CE",  color: c.red,    patterns: ["reddit.com", "redd.it", "v.redd.it"] },
  { name: "SoundCloud",   icon: "\u266A",  color: c.yellow,  patterns: ["soundcloud.com"] },
  { name: "Vimeo",        icon: "\u25B3",  color: c.cyan,   patterns: ["vimeo.com"] },
  { name: "Bilibili",     icon: "\u25C8",  color: c.cyan,   patterns: ["bilibili.com", "b23.tv"] },
  { name: "Spotify",      icon: "\u266B",  color: c.green,  patterns: ["open.spotify.com", "spotify.com"] },
];

function detectPlatform(url) {
  for (const p of PLATFORMS) {
    for (const pat of p.patterns) {
      if (url.includes(pat)) return p;
    }
  }
  return { name: "Other", icon: "\u2022", color: c.white };
}

// ── Check deps ──────────────────────────────────────────────────────
function checkDeps() {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", ["--version"]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    proc.on("error", () => resolve(null));
  });
}

// ── Fetch info ──────────────────────────────────────────────────────
function fetchInfo(url) {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", [
      "--no-download", "--print", "%(title)s|||%(duration)s|||%(uploader)s",
      "--no-warnings", "--no-playlist", url,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", () => {
      const parts = out.trim().split("|||");
      if (parts.length >= 3 && !out.includes("ERROR")) {
        resolve({ title: parts[0], duration: parts[1], uploader: parts[2] });
      } else {
        resolve({ title: null, duration: "0", uploader: null });
      }
    });
    proc.on("error", () => resolve({ title: null, duration: "0", uploader: null }));
  });
}

// ── Quality presets ─────────────────────────────────────────────────
const QUALITIES = [
  { label: "Best",   format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" },
  { label: "1080p",  format: "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best" },
  { label: "720p",   format: "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best" },
  { label: "480p",   format: "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best" },
];

// ── Download ────────────────────────────────────────────────────────
function download(url, outputDir, mode, quality, onEvent) {
  return new Promise((resolve) => {
    const outTemplate = path.join(outputDir || ".", "%(title)s.%(ext)s");
    const args = ["--no-playlist", "--newline", "--no-warnings", "-o", outTemplate];

    if (mode === "audio") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      args.push("-f", QUALITIES[quality]?.format || QUALITIES[0].format);
    }
    args.push(url);

    let filename = "";
    const proc = spawn("yt-dlp", args);

    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+)/);
        if (m) {
          const etaM = line.match(/ETA\s+(\S+)/);
          onEvent({ type: "progress", percent: parseFloat(m[1]), total: m[2], speed: m[3], eta: etaM ? etaM[1] : "?" });
          continue;
        }
        const dm = line.match(/\[download\]\s+Destination:\s+(.+)/);
        if (dm) { filename = path.basename(dm[1].trim()); onEvent({ type: "file", filename }); continue; }
        const mm = line.match(/\[Merger\]\s+Merging formats into "(.+)"/);
        if (mm) { filename = path.basename(mm[1].trim()); onEvent({ type: "file", filename }); }
        const am = line.match(/\[ExtractAudio\]\s+Destination:\s+(.+)/);
        if (am) { filename = path.basename(am[1].trim()); onEvent({ type: "file", filename }); }
      }
    });

    proc.stderr.on("data", (d) => {
      if (d.toString().includes("ERROR")) onEvent({ type: "error", message: d.toString().trim() });
    });

    proc.on("close", (code) => { if (code === 0) onEvent({ type: "done", filename }); resolve(code === 0); });
    proc.on("error", () => { onEvent({ type: "error", message: "Failed to run yt-dlp" }); resolve(false); });
    download._proc = proc;
  });
}
download._proc = null;
download.kill = () => { try { download._proc?.kill("SIGTERM"); } catch {} };

// ── Progress bar factory ────────────────────────────────────────────
function makeBar(plat, title) {
  return new cliProgress.SingleBar({
    format: `  ${plat.color}${plat.icon} ${plat.name}${c.reset}  ${clr(c.white, title)}\n` +
            `  ${clr(c.green, "{bar}")}  ${clr(c.cyan, "{percentage}%")}  ${clr(c.gray, "{speed}")}  ${clr(c.gray, "ETA {eta_formatted}")}`,
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  }, cliProgress.Presets.shades_classic);
}

// ── Interactive download ────────────────────────────────────────────
async function interactiveDL(url, outputDir, mode, quality) {
  const plat = detectPlatform(url);
  const info = await fetchInfo(url);
  const title = info.title || "...";

  process.stdout.write(`\n  ${plat.color}${plat.icon} ${plat.name}${c.reset}  ${clr(c.white, title)}\n`);
  if (info.uploader) process.stdout.write(`  ${clr(c.gray, info.uploader)}\n`);
  process.stdout.write("\n");

  let bar = null;
  let filename = "";
  let error = null;
  let state = "downloading";

  const success = await new Promise((resolve) => {
    const dlDone = download(url, outputDir, mode, quality, (e) => {
      if (e.type === "progress") {
        if (!bar) {
          bar = makeBar(plat, title);
          bar.start(100, 0, { speed: "0 B/s", eta_formatted: "??:??" });
        }
        bar.update(e.percent, { speed: e.speed, eta_formatted: e.eta });
      } else if (e.type === "file") {
        filename = e.filename;
      } else if (e.type === "done") {
        if (bar) bar.update(100, { speed: "", eta_formatted: "00:00" });
        state = "done";
        filename = e.filename || filename;
      } else if (e.type === "error") {
        state = "error";
        error = e.message;
      }
    });

    const onKey = (buf) => { if (buf.toString() === "\u0003") download.kill(); };
    process.stdin.resume();
    process.stdin.on("data", onKey);

    dlDone.then((ok) => {
      process.stdin.removeListener("data", onKey);
      resolve(ok);
    });
  });

  if (bar) bar.stop();

  if (state === "done") {
    let size = "";
    try {
      const fp = path.join(outputDir || ".", filename);
      size = `  ${clr(c.gray, fmtSize(fs.statSync(fp).size))}`;
    } catch {}
    process.stdout.write(`  ${clr(c.green, "\u2714 Complete")}  ${clr(c.white, filename)}${size}\n`);
  } else if (state === "error") {
    process.stdout.write(`  ${clr(c.red, "\u2718 " + (error || "Failed"))}\n`);
  } else {
    process.stdout.write(`  ${clr(c.yellow, "\u23F8 Cancelled")}\n`);
  }
}

// ── Quick download ──────────────────────────────────────────────────
async function quickDL(url, outputDir, mode, quality) {
  const plat = detectPlatform(url);

  process.stdout.write(`\n  ${plat.color}${plat.icon} ${plat.name}${c.reset}\n\n`);

  let bar = null;
  let filename = "";
  let error = null;
  let state = "downloading";

  const success = await new Promise((resolve) => {
    const dlDone = download(url, outputDir, mode, quality, (e) => {
      if (e.type === "progress") {
        if (!bar) {
          bar = makeBar(plat, "Downloading...");
          bar.start(100, 0, { speed: "0 B/s", eta_formatted: "??:??" });
        }
        bar.update(e.percent, { speed: e.speed, eta_formatted: e.eta });
      } else if (e.type === "file") {
        filename = e.filename;
        if (bar) bar.update(bar.lastValue, { speed: bar.lastSpeed });
      } else if (e.type === "done") {
        state = "done";
        filename = e.filename || filename;
      } else if (e.type === "error") {
        state = "error";
        error = e.message;
      }
    });

    const onKey = (buf) => { if (buf.toString() === "\u0003") download.kill(); };
    process.stdin.resume();
    process.stdin.on("data", onKey);

    dlDone.then((ok) => {
      process.stdin.removeListener("data", onKey);
      resolve(ok);
    });
  });

  if (bar) bar.stop();

  if (state === "done") {
    let size = "";
    try {
      const fp = path.join(outputDir || ".", filename);
      size = `  ${clr(c.gray, fmtSize(fs.statSync(fp).size))}`;
    } catch {}
    process.stdout.write(`  ${clr(c.green, "\u2714 Complete")}  ${clr(c.white, filename)}${size}\n`);
  } else {
    process.stdout.write(`  ${clr(c.red, "\u2718 " + (error || "Failed"))}\n`);
  }
}

// ── Menu ────────────────────────────────────────────────────────────
function showMenu() {
  clear();
  process.stdout.write(
    `\n  ${clr(c.bold, "DL-CLI")}\n` +
    `  ${clr(c.dim, "Media Downloader")}\n\n` +
    `  ${clr(c.green, "1")}  ${clr(c.white, "\u25B6  Download Video")}\n` +
    `  ${clr(c.green, "2")}  ${clr(c.white, "\u266B  Download Audio (MP3)")}\n` +
    `  ${clr(c.green, "3")}  ${clr(c.white, "?  Help")}\n` +
    `  ${clr(c.green, "4")}  ${clr(c.white, "\u2716  Exit")}\n\n` +
    `  ${clr(c.gray, "YouTube \u00B7 TikTok \u00B7 Instagram \u00B7 X")}\n` +
    `  ${clr(c.gray, "Facebook \u00B7 Twitch \u00B7 Reddit \u00B7 1000+ sites")}\n\n` +
    `  ${clr(c.green, ">")} `
  );
}

function showHelp() {
  clear();
  process.stdout.write(
    `\n  ${clr(c.bold, "DL-CLI")}\n\n` +
    `  ${clr(c.bold, "USAGE")}\n` +
    `    dl-cli                           Interactive menu\n` +
    `    dl-cli <url>                     Download video\n` +
    `    dl-cli <url> -a                  Download audio (MP3)\n` +
    `    dl-cli <url> -q <1-4>            Quality: 1=best 2=1080p 3=720p 4=480p\n` +
    `    dl-cli <url> -o <dir>            Save to directory\n\n` +
    `  ${clr(c.bold, "PLATFORMS")}\n` +
    `    YouTube, TikTok, Instagram, Twitter/X, Facebook,\n` +
    `    Twitch, Reddit, SoundCloud, Spotify, Vimeo & more\n\n` +
    `  ${clr(c.bold, "REQUIRES")}\n` +
    `    yt-dlp    pip install yt-dlp\n` +
    `    ffmpeg    (for merging/conversion)\n\n`
  );
}

// ── Handle download from menu ───────────────────────────────────────
async function handleDL(mode) {
  clear();
  const label = mode === "audio" ? "Audio" : "Video";
  process.stdout.write(`\n  ${clr(c.bold, `Download ${label}`)}\n\n`);
  const url = await ask(`  ${clr(c.gray, "Paste link:")} `);
  if (!url || !(url.startsWith("http://") || url.startsWith("https://"))) {
    process.stdout.write(`\n  ${clr(c.red, "Invalid URL.")}\n`);
    await ask(`\n  Press Enter...`);
    return;
  }

  let quality = 0;
  if (mode === "video") {
    process.stdout.write(`\n  ${clr(c.bold, "Quality:")}\n`);
    QUALITIES.forEach((q, i) => {
      process.stdout.write(`  ${clr(c.green, String(i + 1))}  ${clr(c.white, q.label)}\n`);
    });
    const q = await ask(`\n  ${clr(c.gray, "Select (1-4, Enter = Best):")} `);
    quality = Math.max(0, Math.min(3, (parseInt(q) || 1) - 1));
  }

  const dir = await ask(`  ${clr(c.gray, "Save to (Enter = current):")} `);
  clear();
  await interactiveDL(url, dir || null, mode, quality);
  process.stdout.write(`\n  ${clr(c.dim, "Press Enter to continue...")}`);
  await ask("");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const deps = await checkDeps();
  if (!deps) {
    clear();
    console.log(`\n  ${clr(c.red, "\u2718 yt-dlp not found!")}`);
    console.log(`  ${clr(c.dim, "Install: pip install yt-dlp")}\n`);
    process.exit(1);
  }

  const args = process.argv.slice(2);

  if (args[0]?.startsWith("http")) {
    let dir = null, mode = "best", quality = 0;
    const oIdx = args.indexOf("-o");
    if (oIdx !== -1 && args[oIdx + 1]) dir = args[oIdx + 1];
    if (args.includes("-a") || args.includes("--audio")) mode = "audio";
    const qIdx = args.indexOf("-q");
    if (qIdx !== -1 && args[qIdx + 1]) {
      const qVal = parseInt(args[qIdx + 1]);
      if (qVal >= 1 && qVal <= 4) quality = qVal - 1;
    }
    await quickDL(args[0], dir, mode, quality);
    return;
  }

  if (args.includes("--help") || args.includes("-h")) { showHelp(); return; }

  while (true) {
    showMenu();
    const ch = await ask("");
    if (ch === "1") await handleDL("video");
    else if (ch === "2") await handleDL("audio");
    else if (ch === "3") { showHelp(); await ask(`  ${clr(c.dim, "Press Enter...")}`); }
    else if (ch === "4") { clear(); process.stdout.write(`  ${clr(c.dim, "Goodbye!")}\n\n`); process.exit(0); }
  }
}

main().catch(() => process.exit(0));
