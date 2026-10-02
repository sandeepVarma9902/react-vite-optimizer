#!/usr/bin/env python3
"""Render a terminal-style product demo video from real `rvo` CLI output.

Reads captured CLI output (with ANSI colors) and renders a 1280x720 MP4 that
looks like a screen recording: typed commands, scrolling output, blinking
cursor. Re-run anytime to regenerate: python3 render.py
"""
import os
import re
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 30
BG = (13, 17, 23)
BAR = (22, 27, 34)
FG = (230, 237, 243)
DIM = (139, 148, 158)
GREEN = (63, 185, 80)
CYAN = (57, 197, 207)
YELLOW = (210, 153, 34)
RED = (248, 81, 73)
SGR_COLORS = {30: DIM, 31: RED, 32: GREEN, 33: YELLOW, 34: (88, 166, 255),
              35: (188, 140, 255), 36: CYAN, 37: FG}

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")
OUT = os.path.join(HERE, "rvo-demo.mp4")

def font(size, bold=False):
    base = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono"
    p = base + ("-Bold.ttf" if bold else ".ttf")
    if not os.path.exists(p):
        p = base + ".ttf"
    return ImageFont.truetype(p, size)

F_REG = font(17)
F_BIG = font(44)
F_MED = font(22)

SGR = re.compile(r"\x1b\[([0-9;]*)m")
EMOJI_DROP = {"\u26a1": "", "\U0001f9e0": "", "\U0001f4be": ""}

def clean(s):
    s = s.replace("/tmp/demo-app", "~/projects/my-app")
    for e, r in EMOJI_DROP.items():
        s = s.replace(e, r)
    return s

def parse_ansi(s):
    """Split a line into (text, color, bold) runs."""
    runs, color, bold, dim, pos = [], FG, False, False, 0
    for m in SGR.finditer(s):
        if m.start() > pos:
            runs.append((s[pos:m.start()], DIM if dim else color, bold))
        for code in m.group(1).split(";"):
            c = int(code or 0)
            if c == 0:
                color, bold, dim = FG, False, False
            elif c == 1:
                bold = True
            elif c == 2:
                dim = True
            elif c == 22:
                bold, dim = False, False
            elif 30 <= c <= 37:
                color = SGR_COLORS[c]
            elif c == 39:
                color = FG
        pos = m.end()
    if pos < len(s):
        runs.append((s[pos:], DIM if dim else color, bold))
    return runs

class Term:
    def __init__(self, rows=27, cols=96):
        self.rows, self.cols = rows, cols
        self.lines = []  # list of run-lists

    def push_line(self, runs):
        self.lines.append(runs)

    def push_wrapped(self, runs):
        # naive wrap on run text (keeps colors)
        text = "".join(t for t, _, _ in runs)
        if len(text) <= self.cols:
            self.push_line(runs)
            return
        # fall back: wrap plain, single color of first run
        color = runs[0][1] if runs else FG
        bold = runs[0][2] if runs else False
        while len(text) > self.cols:
            self.push_line([(text[:self.cols], color, bold)])
            text = text[self.cols:]
        self.push_line([(text, color, bold)])

    def visible(self):
        return self.lines[-self.rows:]

    def clear(self):
        self.lines = []

def draw_chrome(d):
    d.rectangle([0, 0, W, 38], fill=BAR)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([18 + i * 26, 12, 32 + i * 26, 26], fill=c)
    d.text((W // 2 - 90, 10), "sandeep — rvo product demo", font=F_REG, fill=DIM)

def render_frame(term, cursor_visible, cursor_pos=None):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    draw_chrome(d)
    y = 56
    ascent, descent = F_REG.getmetrics()
    lh = ascent + descent + 6
    for runs in term.visible():
        x = 28
        for text, color, bold in runs:
            f = font(17, bold=True) if bold else F_REG
            d.text((x, y), text, font=f, fill=color)
            x += int(d.textlength(text, font=f))
        y += lh
    if cursor_visible and cursor_pos is not None:
        cx, cy = cursor_pos
        d.rectangle([cx, cy, cx + 10, cy + ascent + descent], fill=GREEN)
    return img

def cursor_xy(term):
    d = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    y = 56
    ascent, descent = F_REG.getmetrics()
    lh = ascent + descent + 6
    vis = term.visible()
    y += (len(vis) - 1) * lh if vis else 0
    x = 28
    if vis:
        for text, _, bold in vis[-1]:
            f = font(17, bold=True) if bold else F_REG
            x += int(d.textlength(text, font=f))
    return (x, y)

def save(img, n):
    img.save(os.path.join(FRAMES, f"{n:05d}.png"))
    return n + 1

def blink_frames(term, n, seconds):
    total = int(seconds * FPS)
    for i in range(total):
        n = save(render_frame(term, (i % FPS) < FPS // 2, cursor_xy(term)), n)
    return n

def type_command(term, n, cmd):
    # prompt + separate run for the typed command text
    term.push_line([("$ ", GREEN, True), ("", FG, False)])
    n = blink_frames(term, n, 0.4)
    for ch in cmd:
        runs = term.lines[-1]
        t, c, b = runs[-1]
        runs[-1] = (t + ch, FG, False)
        for _ in range(3):  # ~100ms per char
            n = save(render_frame(term, True, cursor_xy(term)), n)
    # newline after command
    term.push_line([])
    return n

def print_output(term, n, raw_lines, chunk=3, hold=0.22):
    for i in range(0, len(raw_lines), chunk):
        for raw in raw_lines[i:i + chunk]:
            term.push_wrapped(parse_ansi(clean(raw.rstrip("\n"))))
        frames = int(hold * FPS)
        for j in range(frames):
            n = save(render_frame(term, (j % FPS) < FPS // 2, cursor_xy(term)), n)
    return n

def end_card(n, seconds=4.5):
    total = int(seconds * FPS)
    for i in range(total):
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        a = min(1.0, i / (FPS * 0.8))  # fade in
        def fade(c):
            return tuple(int(v * a + BG[k] * (1 - a)) for k, v in enumerate(c))
        d.text((W // 2, 250), "react-vite-optimizer", font=F_BIG, fill=fade(CYAN), anchor="mm")
        d.text((W // 2, 330), "Free to analyze  ·  One-time license  ·  14-day guarantee",
               font=F_MED, fill=fade(FG), anchor="mm")
        d.text((W // 2, 390), "rvo-tools.lemonsqueezy.com", font=F_MED, fill=fade(DIM), anchor="mm")
        n = save(img, n)
    return n

def load(path):
    with open(path, encoding="utf-8") as f:
        return [ln for ln in f.read().split("\n")]

def main():
    os.makedirs(FRAMES, exist_ok=True)
    for f in os.listdir(FRAMES):
        os.remove(os.path.join(FRAMES, f))
    analyze = [l for l in load("/tmp/demo-analyze.txt")]
    fix_full = [l for l in load("/tmp/demo-fix.txt")]
    # beat 3: skip the re-printed analysis, start at "Fix summary"
    start = next(i for i, l in enumerate(fix_full) if "Fix summary" in l)
    fix = fix_full[start:]

    license_beat = [
        "\x1b[2mValidating license key…\x1b[22m",
        "",
        "\x1b[32m✓ License activated.\x1b[39m",
        "\x1b[2m  Commercial commands unlocked: fix, upgrade, all.\x1b[22m",
    ]

    term, n = Term(), 0
    n = blink_frames(term, n, 1.0)
    n = type_command(term, n, "npx react-vite-optimizer analyze ./my-app")
    n = print_output(term, n, analyze)
    n = blink_frames(term, n, 2.5)

    term.clear()
    n = blink_frames(term, n, 0.6)
    n = type_command(term, n, "rvo license XXXX-XXXX-XXXX-XXXX")
    n = print_output(term, n, license_beat)
    n = blink_frames(term, n, 2.0)

    term.clear()
    n = blink_frames(term, n, 0.6)
    n = type_command(term, n, "rvo fix ./my-app -y")
    n = print_output(term, n, fix)
    n = blink_frames(term, n, 3.0)

    n = end_card(n)
    print(f"rendered {n} frames")

    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(FPS), "-i",
        os.path.join(FRAMES, "%05d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", OUT,
    ], check=True)
    info = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                           "format=duration,size", "-of",
                           "default=noprint_wrappers=1", OUT],
                          capture_output=True, text=True, check=True)
    print(info.stdout.strip())
    print("wrote", OUT)

if __name__ == "__main__":
    main()
