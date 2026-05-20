# Markdown Editor

![logo](logo.jpg)

A lightweight WYSIWYG markdown editor built with [Tauri](https://tauri.app) and [Vditor](https://github.com/Vanessa219/vditor).

Work in progress. Inspired by [vscode-markdown-editor](https://github.com/zaaack/vscode-markdown-editor).

## Features

- Three editing modes: WYSIWYG / Instant Rendering / Split View
- Paste & drag-drop image upload → auto-saved to `assets/` folder
- Dark / light theme
- KaTeX, Mermaid support (via Vditor)

## Build from source

```bash
# Dependencies (Fedora)
sudo dnf install rust cargo nodejs npm webkitgtk4.1-devel gtk3-devel

cd markdown-editor
npm install
npm run tauri dev
```

## License

MIT
