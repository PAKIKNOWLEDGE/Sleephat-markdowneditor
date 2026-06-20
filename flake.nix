{
  description = "Sleephat Editor — 轻量 WYSIWYG Markdown 编辑器";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Tauri 2 在 Linux 上需要的系统库
        tauri-system-deps = with pkgs; [
          webkitgtk_4_1        # WebView 渲染（Tauri 2 用 4.1 版）
          gtk3                 # GTK 窗口
          librsvg              # SVG 图标渲染
          libappindicator-gtk3 # 系统托盘
          openssl              # 某些 crate 编译需要
        ];

        # 编译工具链
        native-build-deps = with pkgs; [
          pkg-config           # 让 Rust/Cargo 找到上面的系统库
          cargo                # Rust 构建
          rustc
          nodejs               # 前端构建（npm install → vite build）
        ];

      in {
        # ── 系统包 ──────────────────────────────────────
        # nix build          → 构建出二进制
        # nix profile install → 装到系统
        # 加到 configuration.nix 的 environment.systemPackages
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "sleephat-editor";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = native-build-deps;
          buildInputs = tauri-system-deps;

          # cargo 国内镜像
          CARGO_HOME = "$TMPDIR/cargo-home";

          preConfigure = ''
            # npm 换源（淘宝镜像）
            npm config set registry "https://registry.npmmirror.com"

            # cargo 换源（中科大）
            mkdir -p $CARGO_HOME
            cat > $CARGO_HOME/config.toml <<EOF
[source.crates-io]
replace-with = "ustc"

[source.ustc]
registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
EOF
          '';

          buildPhase = ''
            # 1. 前端：npm install → vite build → dist/
            npm install --ignore-scripts
            npm run build

            # 2. 后端：Cargo 编译（会自动嵌入 dist/）
            cargo build \
              --manifest-path src-tauri/Cargo.toml \
              --release \
              --frozen
          '';

          installPhase = ''
            mkdir -p $out/bin
            cp src-tauri/target/release/markdown-editor $out/bin/sleephat-editor

            # 图标 + desktop entry（让系统菜单里能搜到）
            mkdir -p $out/share/icons/hicolor/128x128/apps
            cp src-tauri/icons/128x128.png $out/share/icons/hicolor/128x128/apps/sleephat-editor.png
            mkdir -p $out/share/applications
            substituteAll ${./sleephat-editor.desktop.in} $out/share/applications/sleephat-editor.desktop
          '';

          meta = with pkgs.lib; {
            description = "A lightweight WYSIWYG markdown editor powered by Vditor";
            homepage = "https://github.com/pachu77/markdown-editor";
            license = licenses.mit;
            platforms = [ "x86_64-linux" ];
            mainProgram = "sleephat-editor";
          };
        };

        # ── 开发环境 ────────────────────────────────────
        # nix develop → 进入环境，里面 npm / cargo / webkit 全有
        # 不污染全局，用完退出来就行
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = native-build-deps;
          buildInputs = tauri-system-deps;

          shellHook = ''
            export PKG_CONFIG_PATH="${pkgs.webkitgtk_4_1}/lib/pkgconfig:$PKG_CONFIG_PATH"
            echo ""
            echo "  🧢  Sleephat Editor 开发环境"
            echo "  ───────────────────────────"
            echo "  npm run tauri dev   → 热重载开发"
            echo "  npm run tauri build → 发布构建"
            echo "  nix build           → 打系统包"
            echo ""
          '';
        };
      }
    );
}
