# Maintainer: pachu77 <pachu77@example.com>
# Contributor: pachu77

pkgname=markdown-editor
pkgver=0.1.0
pkgrel=1
pkgdesc="A lightweight WYSIWYG markdown editor powered by Vditor"
arch=('x86_64')
url="https://github.com/pachu77/markdown-editor"
license=('MIT')
depends=(
  'webkitgtk-6.0'
  'libappindicator-gtk3'
  'librsvg'
)
makedepends=(
  'cargo'
  'nodejs'
  'npm'
  'rust'
)
source=("$pkgname-$pkgver.tar.gz::https://github.com/pachu77/markdown-editor/archive/v$pkgver.tar.gz")
sha256sums=('SKIP')

prepare() {
  cd "$srcdir/$pkgname-$pkgver"
  npm install
}

build() {
  cd "$srcdir/$pkgname-$pkgver"
  npm run build
  cargo build --manifest-path src-tauri/Cargo.toml --release
}

package() {
  cd "$srcdir/$pkgname-$pkgver"
  install -Dm755 "src-tauri/target/release/$pkgname" "$pkgdir/usr/bin/$pkgname"
  install -Dm644 "src-tauri/icons/128x128.png" "$pkgdir/usr/share/pixmaps/$pkgname.png"
  install -Dm644 "LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"

  # Desktop file
  mkdir -p "$pkgdir/usr/share/applications"
  cat > "$pkgdir/usr/share/applications/$pkgname.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Markdown Editor
Comment=$pkgdesc
Exec=$pkgname
Icon=$pkgname
Terminal=false
Categories=Office;TextEditor;
StartupWMClass=markdown-editor
EOF
}
