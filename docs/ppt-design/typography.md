# 字体与字号规范

> 知识库版本 1.0 · 2026-10-23
> 体系：衬线大标题 + 无衬线正文 + 等宽标签（Anthropic 风格的可自由分发替代方案）

## 1. 字体栈

| 用途 | 首选 | 备选 | 中文 |
|---|---|---|---|
| 大标题 / 章节 | **Source Serif 4**（Semibold） | Georgia | **思源宋体 / Noto Serif SC**（Bold） |
| 正文 | **Inter**（Regular / Medium） | Segoe UI | **思源黑体 / Noto Sans SC**（Regular） |
| 标签 / 编号 / 页码 | **JetBrains Mono** | Consolas | — |

- 中文正文保底：微软雅黑；中文标题保底：宋体 Bold
- 数字统一 Inter SemiBold，等宽数字（tabular numerals），避免跳动

## 2. 字号（1920×1080）

| 层级 | 字号 | 字重 | 行高 | 字距 |
|---|---:|---|---:|---:|
| 封面标题 | 88pt | Serif Semibold | 1.15 | -1% |
| 章节标题 | 64pt | Serif Semibold | 1.15 | -1% |
| 页标题 | 40pt | Serif Semibold | 1.15 | -1% |
| 导语 | 24pt | Sans Regular | 1.6 | 0 |
| 正文 | 20pt | Sans Regular | 1.6 | 0 |
| 图注 | 13pt | Sans Regular | 1.5 | 0 |
| 眉标（如 `VERIFY · 04`） | 12pt | Mono Medium | 1.2 | +8% |

- 标题与正文对比 ≥ 2.2 倍
- 中文标题左对齐（封面与满版页居中）
- 中文每行 ≤ 32 字；导语 ≤ 2 行

## 3. 用色与排版关系

- 正文一律 `#1F1F1F`；次级文字 `#6B6660`
- 珊瑚 `#D97757` 只用于 ≥24pt 的大字（对比度约 3.0:1）
- 珊瑚满版页上的文字用暖白 `#FAF9F5`

## 4. 安装（渲染机与编辑机都要装）

Google Fonts（OFL，可自由使用）：

| 字体 | 下载 |
|---|---|
| Source Serif 4 | https://fonts.google.com/specimen/Source+Serif+4 |
| Inter | https://fonts.google.com/specimen/Inter |
| JetBrains Mono | https://fonts.google.com/specimen/JetBrains+Mono |
| Noto Serif SC | https://fonts.google.com/noto/specimen/Noto+Serif+SC |
| Noto Sans SC | https://fonts.google.com/noto/specimen/Noto+Sans+SC |

- **WSL / Linux**：`.ttf` / `.otf` 放进 `~/.local/share/fonts/`，Chromium 下次启动生效
- **Windows（WPS 导出必需）**：右键「安装」或复制到 `C:\Users\<用户>\AppData\Local\Microsoft\Windows\Fonts`，再导入注册表；管理员权限下可装到 `C:\Windows\Fonts`
- **PPTX 中的字体名必须与系统注册名一致**，否则会静默回退成宋体/雅黑。常见注册名：
  - `Source Serif 4 Semibold`
  - `Inter`
  - `Noto Serif SC Bold`
  - `Noto Sans SC`
  - `JetBrains Mono`

## 5. 回退策略

按以下顺序降级，不允许出现第四种字体：

1. Source Serif 4 → Noto Serif SC → 宋体 Bold
2. Inter → Noto Sans SC → 微软雅黑
3. JetBrains Mono → Consolas

## 6. 检查

- [ ] 全片字体不超过 3 族
- [ ] 标题 ≥ 40pt（封面 88 / 章节 64）
- [ ] 正文 ≥ 20pt，图注 ≥ 13pt
- [ ] 中文标题左对齐、无居中段落
- [ ] PPTX 打开后没有字体替换提示
