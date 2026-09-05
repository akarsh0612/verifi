import os
from PIL import Image, ImageDraw

icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(icons_dir, exist_ok=True)

for size in [16, 48, 128]:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Background rounded rectangle
    margin = max(1, size // 16)
    radius = size // 4
    # Teal/Emerald medical gradient-like color #0d9488
    bg_color = (13, 148, 136, 255)
    draw.rounded_rectangle([margin, margin, size - margin, size - margin], radius=radius, fill=bg_color)
    
    # Draw a medical cross in white
    cross_color = (255, 255, 255, 255)
    center = size / 2.0
    arm_len = size * 0.28
    thickness = max(2, int(size * 0.18))
    half_thick = thickness / 2.0
    
    # Horizontal bar
    draw.rounded_rectangle(
        [center - arm_len, center - half_thick, center + arm_len, center + half_thick],
        radius=max(1, thickness // 4),
        fill=cross_color
    )
    # Vertical bar
    draw.rounded_rectangle(
        [center - half_thick, center - arm_len, center + half_thick, center + arm_len],
        radius=max(1, thickness // 4),
        fill=cross_color
    )
    
    # In 48 and 128 sizes, add a small checkmark in bottom-right badge
    if size >= 48:
        badge_radius = size * 0.22
        bx = size - margin - badge_radius
        by = size - margin - badge_radius
        draw.ellipse([bx - badge_radius, by - badge_radius, bx + badge_radius, by + badge_radius], fill=(16, 185, 129, 255), outline=(255, 255, 255, 255), width=max(1, size // 32))
        # Draw checkmark inside badge
        pts = [
            (bx - badge_radius * 0.45, by),
            (bx - badge_radius * 0.1, by + badge_radius * 0.4),
            (bx + badge_radius * 0.5, by - badge_radius * 0.35)
        ]
        draw.line(pts, fill=(255, 255, 255, 255), width=max(2, size // 24))

    out_path = os.path.join(icons_dir, f'icon-{size}.png')
    img.save(out_path, 'PNG')
    print(f'Generated {out_path} ({size}x{size})')
