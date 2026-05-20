# Fedora COPR spec for markdown-editor
# Built with: cargo tauri build --bundles rpm

%global debug_package %{nil}

Name:           markdown-editor
Version:        0.1.0
Release:        1%{?dist}
Summary:        A lightweight WYSIWYG markdown editor powered by Vditor

License:        MIT
URL:            https://github.com/pachu77/markdown-editor
Source0:        %{name}-%{version}.tar.gz

# Build dependencies
BuildRequires:  rust >= 1.70
BuildRequires:  cargo
BuildRequires:  nodejs >= 18
BuildRequires:  npm
BuildRequires:  webkitgtk4.1-devel
BuildRequires:  gtk3-devel
BuildRequires:  libappindicator-gtk3-devel
BuildRequires:  librsvg2-devel
BuildRequires:  openssl-devel

# Runtime dependencies
Requires:       webkitgtk4.1
Requires:       gtk3
Requires:       libappindicator-gtk3
Requires:       librsvg2

%description
A lightweight WYSIWYG markdown editor powered by Vditor.
Built with Tauri, supports WYSIWYG / IR / Split View editing modes,
with KaTeX, Mermaid, and other markdown extensions.

%prep
%setup -q

%build
# Build frontend
npm install
npm run build

# Build Rust backend
cd src-tauri
cargo build --release
cd ..

%install
# Binary
install -Dpm 0755 src-tauri/target/release/markdown-editor %{buildroot}%{_bindir}/markdown-editor

# Icon
install -Dpm 0644 src-tauri/icons/128x128.png %{buildroot}%{_datadir}/icons/hicolor/128x128/apps/markdown-editor.png
install -Dpm 0644 src-tauri/icons/32x32.png %{buildroot}%{_datadir}/icons/hicolor/32x32/apps/markdown-editor.png

# Desktop entry
mkdir -p %{buildroot}%{_datadir}/applications
cat > %{buildroot}%{_datadir}/applications/markdown-editor.desktop << EOF
[Desktop Entry]
Type=Application
Name=Markdown Editor
Comment=%{summary}
Exec=markdown-editor
Icon=markdown-editor
Terminal=false
Categories=Office;TextEditor;
StartupWMClass=markdown-editor
EOF

# Appdata
mkdir -p %{buildroot}%{_datadir}/metainfo
cat > %{buildroot}%{_datadir}/metainfo/markdown-editor.metainfo.xml << EOF
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>com.sleephat.markdown-editor</id>
  <name>Markdown Editor</name>
  <summary>WYSIWYG Markdown Editor</summary>
  <developer_name>pachu77</developer_name>
  <description>
    <p>
      A lightweight WYSIWYG markdown editor powered by Vditor.
      Supports WYSIWYG, Instant Rendering, and Split View modes
      with KaTeX math, Mermaid diagrams, and more.
    </p>
  </description>
  <url type="homepage">https://github.com/pachu77/markdown-editor</url>
  <project_license>MIT</project_license>
</component>
EOF

%files
%{_bindir}/markdown-editor
%{_datadir}/icons/hicolor/128x128/apps/markdown-editor.png
%{_datadir}/icons/hicolor/32x32/apps/markdown-editor.png
%{_datadir}/applications/markdown-editor.desktop
%{_datadir}/metainfo/markdown-editor.metainfo.xml
%license LICENSE
%doc README.md

%changelog
* Thu May 21 2026 pachu77 <pachu77@example.com> - 0.1.0-1
- Initial package
