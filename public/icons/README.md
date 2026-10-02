# 拾页书柜图标

- `folio.png`：内置 AI 绘图工具生成的原始透明 PNG，保留原图。
- `folio.ico`：由原图做尺寸缩放与 ICO 封装，含 16、24、32、48、64、128、256 像素七个尺寸；用于 Windows 快捷方式，也用于浏览器标签页。
- 生成模式：内置 `image_gen`，未使用 API Key 或外部图标网站。
- 项目素材随本项目按 MIT 许可公开；AI 参与声明见仓库根目录 `AI_USAGE.md`。

快捷方式中的 ICO 路径由 `scripts/shortcuts.ps1` 在使用者自己的电脑上生成，不发布某台电脑上的 `.lnk` 成品。用户可自主选择桌面、开始菜单、两者或不创建。

## 格式转换复现

在仓库源码目录中使用 Windows PowerShell（普通用户无需转换，免安装包已附带 ICO）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-icon.ps1
```

只进行尺寸转换和多尺寸文件封装，不改变原图的构图与透明背景。

## 最终绘图提示词

```text
Use case: logo-brand. Asset type: a polished Windows desktop application icon for 拾页 Folio, a cozy local bookshelf for reading and organizing important files. Generate ONE square 1024x1024 icon, not a mockup or contact sheet. A centered deep forest-green rounded-square enamel tile, with genuinely transparent pixels OUTSIDE the rounded tile. On the tile, depict a beautifully simple warm-ivory miniature bookshelf with three chunky upright books: cream, muted copper/terracotta, and sage green, a small muted-gold bookmark/page accent. The three books stand on one short warm-gold shelf. Strong readable silhouette and wide, clean color masses, works at 32x32 and 48x48; no tiny details. Restrained tactile 3D illustration, slightly softened bevels and subtle warm highlights, almost frontal view, calm literary feeling, timeless desktop icon design, elegant and welcoming rather than childish. Keep the bookshelf illustration large and centered, safe margins about 12 percent. No text, no letters, no numbers, no logo copied from any existing brand, no watermark, no external objects, no white rectangular canvas, no pre-rendered shortcut-arrow badge. Preserve actual alpha transparency outside the rounded-square tile.
```

工具实际输出为 1254 × 1254；ICO 转换按上述七个尺寸生成。
