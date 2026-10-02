#!/usr/bin/env python3
"""Render a terminal-style demo video from REAL `rvo` CLI output.

Pipeline (all output captured from genuine commands, never mocked):
  1. npm i -g react-vite-optimizer      (real npm registry install)
  2. rvo --version
  3. cd bulletproof-react && rvo analyze (real: 115 files, 91 findings)
  4. rvo fix                            (real license-gate upsell, no key present)
  5. rvo license --help                 (real paid-command interface)

Captures live in /tmp/ls2-capture/*.txt (ANSI colors preserved via FORCE_COLOR=1).
Re-run anytime: python3 render_bigrepo.py
"""
import os
import re
import subprocess
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
FRAMES = os.path.join(HERE, "frames_bigrepo")
CAP = "/tmp/ls2-capture"
OUT = os.path.join(HERE, "rvo-demo-bigrepo.mp4")

BANNER = {"text": None}  # current step banner, drawn top-right


def font(size, bold=False):
    base = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono"
    p = base + ("-Bold.ttf" if bold else ".ttf")
    if not os.path.exists(p):
        p = base + ".ttf"
    return ImageFont.truetype(p, size)


F_REG = font(17)
F_BIG = font(44)
F_MED = font(22)
F_BAN = font(19, bold=True)

SGR = re.compile(r"\x1b\[([0-9;]*)m")
# DejaVu Sans Mono lacks these glyphs -> drop them (same as original pipeline)
EMOJI_DROP = {"⚡": "", "🧠": "", "💾": ""}


def clean(s):
    s = s.replace("/tmp/bulletproof-react/apps/react-vite",
                  "~/projects/bulletproof-react")
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
    def __init__(self, rows=22, cols=96):
        self.rows, self.cols = rows, cols
        self.lines = []

    def push_line(self, runs):
        self.lines.append(runs)

    def push_wrapped(self, runs):
        text = "".join(t for t, _, _ in runs)
        if len(text) <= self.cols:
            self.push_line(runs)
            return
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
    d.text((W // 2 - 130, 10), "rvo — live demo on bulletproof-react",
           font=F_REG, fill=DIM)


def draw_banner(d):
    t = BANNER["text"]
    if not t:
        return
    tw = int(d.textlength(t, font=F_BAN))
    pad_x, pad_y = 16, 8
    x1, y1 = W - tw - pad_x * 2 - 24, 50
    x2, y2 = W - 24, 50 + 36
    d.rounded_rectangle([x1, y1, x2, y2], radius=10, outline=GREEN, width=2)
    d.text(((x1 + x2) // 2, (y1 + y2) // 2 - 1), t, font=F_BAN,
           fill=GREEN, anchor="mm")


def render_frame(term, cursor_visible, cursor_pos=None):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    draw_chrome(d)
    draw_banner(d)
    y = 100  # terminal text starts below the step banner (no overlap)
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
    y = 100
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
    term.push_line([("$ ", GREEN, True), ("", FG, False)])
    n = blink_frames(term, n, 0.4)
    for ch in cmd:
        runs = term.lines[-1]
        t, c, b = runs[-1]
        runs[-1] = (t + ch, FG, False)
        for _ in range(3):  # ~100ms per char
            n = save(render_frame(term, True, cursor_xy(term)), n)
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
        a = min(1.0, i / (FPS * 0.8))

        def fade(c):
            return tuple(int(v * a + BG[k] * (1 - a)) for k, v in enumerate(c))

        d.text((W // 2, 250), "react-vite-optimizer", font=F_BIG,
               fill=fade(CYAN), anchor="mm")
        d.text((W // 2, 330), "Free to analyze  ·  One-time license  ·  14-day guarantee",
               font=F_MED, fill=fade(FG), anchor="mm")
        d.text((W // 2, 390), "rvo-tools.lemonsqueezy.com", font=F_MED,
               fill=fade(DIM), anchor="mm")
        n = save(img, n)
    return n


def load(name):
    with open(os.path.join(CAP, name), encoding="utf-8") as f:
        # drop fully-blank lines at the very start/end only
        lines = f.read().split("\n")
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()
        return lines


def beat(term, n, banner, cmd, capture, chunk=3, hold=0.22, clear_first=True):
    BANNER["text"] = banner
    if clear_first:
        term.clear()
        n = blink_frames(term, n, 0.6)
    n = type_command(term, n, cmd)
    n = print_output(term, n, load(capture), chunk=chunk, hold=hold)
    n = blink_frames(term, n, 2.0)
    return n


def main():
    os.makedirs(FRAMES, exist_ok=True)
    for f in os.listdir(FRAMES):
        os.remove(os.path.join(FRAMES, f))

    term, n = Term(), 0
    n = blink_frames(term, n, 1.0)

    n = beat(term, n, "STEP 1 \u2014 install from npm",
             "npm i -g react-vite-optimizer", "install.txt",
             chunk=2, hold=0.5)

    n = beat(term, n, "STEP 2 \u2014 verify the install",
             "rvo --version", "version.txt", chunk=2, hold=0.8)

    # real cd into the cloned app, then the analyze run
    BANNER["text"] = "STEP 3 \u2014 analyze a real app (115 files)"
    term.clear()
    n = blink_frames(term, n, 0.6)
    n = type_command(term, n, "cd ~/projects/bulletproof-react")
    n = type_command(term, n, "rvo analyze")
    n = print_output(term, n, load("analyze.txt"), chunk=4, hold=0.16)
    n = blink_frames(term, n, 2.5)

    n = beat(term, n, "STEP 4 \u2014 fix needs a license",
             "rvo fix", "fix-gate.txt", chunk=2, hold=0.45)

    # STEP 5: real license activation (key masked on screen, output genuine)
    n = beat(term, n, "STEP 5 \u2014 activate the license",
             "rvo license XXXX-XXXX-XXXX-XXXX", "license-activate.txt",
             chunk=2, hold=0.6)

    # STEP 6: real fix run — show only the Fix summary section
    BANNER["text"] = "STEP 6 \u2014 apply the fixes"
    term.clear()
    n = blink_frames(term, n, 0.6)
    n = type_command(term, n, "rvo fix -y")
    fix_full = load("fix.txt")
    start = next(i for i, l in enumerate(fix_full) if "Fix summary" in l)
    n = print_output(term, n, fix_full[start:], chunk=3, hold=0.3)
    n = blink_frames(term, n, 2.5)

    # STEP 7: the results — what changed on disk
    n = beat(term, n, "STEP 7 \u2014 the results",
             "git diff --stat | tail -8", "diffstat.txt",
             chunk=8, hold=0.8)

    BANNER["text"] = None
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
