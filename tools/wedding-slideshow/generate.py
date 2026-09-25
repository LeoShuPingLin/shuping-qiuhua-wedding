from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def natural_key(path: Path):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\\d+)", path.name)]


def load_config(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def color(value: str, alpha: int = 255):
    value = value.strip().lstrip("#")
    if len(value) != 6:
        raise ValueError(f"Invalid hex color: {value}")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def open_image(path: Path) -> Image.Image:
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def cover_image(img: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / img.width, height / img.height)
    new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    img = img.resize(new_size, Image.Resampling.LANCZOS)
    left = (img.width - width) // 2
    top = (img.height - height) // 2
    return img.crop((left, top, left + width, top + height))


def prepare_background(path: Path, width: int, height: int, blur_radius: float, brightness: float) -> Image.Image:
    if not path.exists():
        raise FileNotFoundError(f"Background image not found: {path}")
    img = cover_image(open_image(path), width, height)
    if blur_radius > 0:
        img = img.filter(ImageFilter.GaussianBlur(blur_radius))
    if brightness != 1:
        img = ImageEnhance.Brightness(img).enhance(brightness)
    return img.convert("RGBA")


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=max(0, radius), fill=255)
    return mask


def make_photo_card(path: Path, carousel: dict) -> Image.Image:
    photo_height = int(carousel["photo_height"])
    padding = int(carousel["frame_padding"])
    corner_radius = int(carousel["corner_radius"])
    shadow_blur = int(carousel["shadow_blur"])
    shadow_offset_y = int(carousel["shadow_offset_y"])
    shadow_opacity = int(carousel["shadow_opacity"])

    img = open_image(path)
    width = max(1, round(img.width * (photo_height / img.height)))
    img = img.resize((width, photo_height), Image.Resampling.LANCZOS).convert("RGBA")

    inner_radius = max(0, corner_radius - padding // 2)
    img.putalpha(rounded_mask(img.size, inner_radius))

    card_w = width + padding * 2
    card_h = photo_height + padding * 2
    card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))

    frame_layer = Image.new("RGBA", card.size, color(carousel["frame_color"]))
    frame_layer.putalpha(rounded_mask(card.size, corner_radius))
    card.alpha_composite(frame_layer)
    card.alpha_composite(img, dest=(padding, padding))

    margin = max(4, shadow_blur * 2)
    extra_bottom = max(0, shadow_offset_y)
    canvas_w = card_w + margin * 2
    canvas_h = card_h + margin * 2 + extra_bottom

    shadow = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    shadow_shape = Image.new("L", (canvas_w, canvas_h), 0)
    draw = ImageDraw.Draw(shadow_shape)
    x0 = margin
    y0 = margin + shadow_offset_y
    draw.rounded_rectangle(
        (x0, y0, x0 + card_w - 1, y0 + card_h - 1),
        radius=corner_radius,
        fill=max(0, min(255, shadow_opacity)),
    )
    if shadow_blur > 0:
        shadow_shape = shadow_shape.filter(ImageFilter.GaussianBlur(shadow_blur))
    shadow.putalpha(shadow_shape)

    result = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    result.alpha_composite(shadow)
    result.alpha_composite(card, dest=(margin, margin))
    return result


def load_photo_cards(photos_dir: Path, carousel: dict) -> list[Image.Image]:
    if not photos_dir.exists():
        raise FileNotFoundError(f"Photos directory not found: {photos_dir}")

    files = sorted(
        [p for p in photos_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS],
        key=natural_key,
    )
    if not files:
        raise RuntimeError(f"No photos found in: {photos_dir}")

    print(f"Found {len(files)} carousel photos.")
    return [make_photo_card(path, carousel) for path in files]


def build_cycle(cards: list[Image.Image], gap: int, min_width: int) -> Image.Image:
    sequence = list(cards)

    def seq_width(items):
        return sum(img.width + gap for img in items)

    while seq_width(sequence) < min_width + gap:
        sequence.extend(cards)

    cycle_w = seq_width(sequence)
    cycle_h = max(img.height for img in sequence)
    strip = Image.new("RGBA", (cycle_w, cycle_h), (0, 0, 0, 0))

    x = 0
    for card in sequence:
        y = (cycle_h - card.height) // 2
        strip.alpha_composite(card, dest=(x, y))
        x += card.width + gap

    return strip


def make_base_frame(base_dir: Path, cfg: dict) -> tuple[Image.Image, int, int]:
    canvas = cfg["canvas"]
    bg = cfg["background"]

    width = int(canvas["width"])
    height = int(canvas["height"])
    top_h = int(bg["top_height"])
    bottom_h = int(bg["bottom_height"])

    if top_h < 0 or bottom_h < 0 or top_h + bottom_h >= height:
        raise ValueError("top_height + bottom_height must be smaller than canvas height.")

    base = Image.new("RGBA", (width, height), color(canvas["background_color"]))

    top = prepare_background(
        base_dir / bg["top_image"],
        width,
        top_h,
        float(bg["blur_radius"]),
        float(bg["brightness"]),
    )
    bottom = prepare_background(
        base_dir / bg["bottom_image"],
        width,
        bottom_h,
        float(bg["blur_radius"]),
        float(bg["brightness"]),
    )

    base.alpha_composite(top, dest=(0, 0))
    base.alpha_composite(bottom, dest=(0, height - bottom_h))
    return base, top_h, bottom_h


def phase_for_frame(frame_index: int, total_frames: int, cycle_width: int, loop_cycles: int, direction: str) -> int:
    phase = (frame_index * loop_cycles * cycle_width) / total_frames
    offset = int(round(phase)) % cycle_width
    if direction == "left":
        return -offset
    if direction == "right":
        return offset - cycle_width
    raise ValueError("carousel.direction must be 'left' or 'right'.")


def compose_frame(base: Image.Image, strip: Image.Image, track_y: int, phase_x: int) -> Image.Image:
    frame = base.copy()
    x = phase_x

    while x > 0:
        x -= strip.width

    while x < frame.width:
        frame.alpha_composite(strip, dest=(x, track_y))
        x += strip.width

    return frame


def calculate_timing(cfg: dict, strip_width: int) -> tuple[int, int, float, float]:
    fps = int(cfg["canvas"]["fps"])
    speed = float(cfg["carousel"]["speed_px_per_second"])
    loop_cycles = int(cfg["carousel"].get("loop_cycles", 1))

    if fps <= 0 or speed <= 0 or loop_cycles <= 0:
        raise ValueError("fps, speed_px_per_second and loop_cycles must be greater than 0.")

    natural_duration = (strip_width * loop_cycles) / speed
    total_frames = max(1, round(natural_duration * fps))
    actual_duration = total_frames / fps
    effective_speed = (strip_width * loop_cycles) / actual_duration
    return fps, total_frames, actual_duration, effective_speed


def render_preview(base_dir: Path, cfg: dict, base: Image.Image, strip: Image.Image, track_y: int):
    fps, total_frames, duration, _ = calculate_timing(cfg, strip.width)
    preview_second = float(cfg["output"].get("preview_second", 0))
    frame_index = round((preview_second % duration) * fps)
    frame_index = min(frame_index, total_frames - 1)

    direction = cfg["carousel"]["direction"].lower()
    loop_cycles = int(cfg["carousel"].get("loop_cycles", 1))
    x = phase_for_frame(frame_index, total_frames, strip.width, loop_cycles, direction)
    frame = compose_frame(base, strip, track_y, x).convert("RGB")

    output_path = base_dir / cfg["output"]["preview_file"]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame.save(output_path)
    print(f"Preview written to: {output_path}")


def render_video(base_dir: Path, cfg: dict, base: Image.Image, strip: Image.Image, track_y: int):
    fps, total_frames, duration, effective_speed = calculate_timing(cfg, strip.width)
    output = cfg["output"]
    output_path = base_dir / output["video_file"]
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Cycle width: {strip.width}px")
    print(f"Duration: {duration:.2f}s")
    print(f"Effective speed: {effective_speed:.2f}px/s")
    print(f"Frames: {total_frames} @ {fps}fps")

    writer = imageio.get_writer(
        str(output_path),
        fps=fps,
        codec="libx264",
        macro_block_size=None,
        ffmpeg_params=[
            "-crf", str(int(output.get("crf", 18))),
            "-preset", str(output.get("preset", "medium")),
            "-pix_fmt", "yuv420p",
        ],
    )

    direction = cfg["carousel"]["direction"].lower()
    loop_cycles = int(cfg["carousel"].get("loop_cycles", 1))
    progress_step = max(1, total_frames // 20)

    try:
        for i in range(total_frames):
            x = phase_for_frame(i, total_frames, strip.width, loop_cycles, direction)
            frame = compose_frame(base, strip, track_y, x).convert("RGB")
            writer.append_data(np.asarray(frame, dtype=np.uint8))

            if i % progress_step == 0 or i == total_frames - 1:
                pct = (i + 1) / total_frames * 100
                print(f"\\rRendering: {pct:5.1f}%", end="", flush=True)
    finally:
        writer.close()

    print()
    print(f"Video written to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate a seamless wedding photo carousel video.")
    parser.add_argument("--config", default="config.json", help="Config file path, relative to this script.")
    parser.add_argument("--preview", action="store_true", help="Generate a PNG preview instead of MP4.")
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parent
    config_path = (base_dir / args.config).resolve()
    cfg = load_config(config_path)

    base, top_h, bottom_h = make_base_frame(base_dir, cfg)

    carousel = cfg["carousel"]
    photos_dir = base_dir / carousel["photos_dir"]
    cards = load_photo_cards(photos_dir, carousel)
    strip = build_cycle(cards, int(carousel["gap"]), int(cfg["canvas"]["width"]))

    center_h = int(cfg["canvas"]["height"]) - top_h - bottom_h
    track_y = top_h + (center_h - strip.height) // 2 + int(carousel.get("vertical_offset", 0))

    if track_y < 0 or track_y + strip.height > int(cfg["canvas"]["height"]):
        print("Warning: carousel extends outside the canvas; adjust photo_height/vertical_offset if unintended.")

    if args.preview:
        render_preview(base_dir, cfg, base, strip, track_y)
    else:
        render_video(base_dir, cfg, base, strip, track_y)


if __name__ == "__main__":
    main()
