# Sleephat Editor

![logo](logo.jpg)

A lightweight WYSIWYG markdown editor built with [Tauri](https://tauri.app) and [Vditor](https://github.com/Vanessa219/vditor).

Inspired by [vscode-markdown-editor](https://github.com/zaaack/vscode-markdown-editor).

## Features

- Three editing modes: WYSIWYG / Instant Rendering / Split View
- Paste & drag-drop image upload → auto-saved to an `assets/` folder
- Dark / light theme
- KaTeX and Mermaid support (via Vditor)
- Auto-save with external file change detection
- Table editing toolbar (IR mode)
- CLI support: `sleephat-editor path/to/file.md`

## Build from Source

### Dependencies (Debian/Ubuntu)

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  librsvg2-dev libayatana-appindicator3-dev \
  rustc cargo nodejs npm
```

### Dependencies (Fedora)

```bash
sudo dnf install rust cargo nodejs npm \
  webkitgtk4.1-devel gtk3-devel
```

### Build & Run

```bash
cd Sleephat-markdowneditor
npm install
npm run tauri dev      # development
npm run tauri build    # release (produces .deb)
```

## License

MIT
