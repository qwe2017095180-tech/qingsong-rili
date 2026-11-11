"""生成「轻松日程」应用图标（多尺寸 .ico + 512px png）。

配色取自 public/style.css：mint #57bd9b / mint-deep #3fa383 / peach #f0a468。
运行：python build/make_icon.py
"""
import os

from PIL import Image, ImageDraw

S = 1024
TOP = (0x6E, 0xCD, 0xAC)
BOTTOM = (0x3F, 0xA3, 0x83)
WHITE = (255, 255, 255, 255)
PEACH = (0xF0, 0xA4, 0x68, 255)
MINT_SOFT = (0xE7, 0xF7, 0xF0, 255)
INK = (0x3B, 0x3B, 0x35, 255)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def build():
    # 背景渐变
    grad = Image.new("RGBA", (S, S))
    d = ImageDraw.Draw(grad)
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(TOP, BOTTOM, y / (S - 1)) + (255,))
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.paste(grad, (0, 0), rounded_mask(S, 232))

    d = ImageDraw.Draw(canvas)

    # 日历上方两个挂环
    for x in (300, 656):
        d.rounded_rectangle([x, 214, x + 68, 330], radius=34, fill=WHITE)

    # 日历主体
    d.rounded_rectangle([212, 288, 812, 826], radius=72, fill=WHITE)
    # 顶部色带（只覆盖上半部分圆角）
    header = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(header)
    hd.rounded_rectangle([212, 288, 812, 826], radius=72, fill=BOTTOM + (255,))
    hd.rectangle([212, 420, 812, 826], fill=(0, 0, 0, 0))
    canvas.alpha_composite(header)

    # 日期格：两行三列
    for row in range(2):
        for col in range(3):
            x = 300 + col * 176
            y = 492 + row * 168
            fill = MINT_SOFT if not (row == 1 and col == 1) else PEACH
            d.rounded_rectangle([x, y, x + 128, y + 116], radius=26, fill=fill)

    canvas.save(os.path.join(os.path.dirname(__file__), "icon.png"))

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    canvas.save(
        os.path.join(os.path.dirname(__file__), "icon.ico"),
        format="ICO",
        sizes=sizes,
    )
    print("icon.png / icon.ico 已生成")


if __name__ == "__main__":
    build()
