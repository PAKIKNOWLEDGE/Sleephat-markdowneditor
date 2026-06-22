{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  pname = "sleephat-editor";
  version = "0.1.0";

  # 不拷整个项目，只拿需要的几个文件
  src = null;

  # 不解压、不编译、不联网
  unpackPhase = "true";
  buildPhase = "true";

  nativeBuildInputs = with pkgs; [ wrapGAppsHook3 ];

  buildInputs = with pkgs; [
    webkitgtk_4_1 gtk3 librsvg
    gsettings-desktop-schemas glib-networking dconf
    gst_all_1.gst-plugins-base
  ];

  installPhase = ''
    mkdir -p $out/bin
    cp ${./src-tauri/target/release/markdown-editor} $out/bin/sleephat-editor

    mkdir -p $out/share/icons/hicolor/128x128/apps
    cp ${./src-tauri/icons/128x128.png} $out/share/icons/hicolor/128x128/apps/sleephat-editor.png

    mkdir -p $out/share/applications
    substituteAll ${./sleephat-editor.desktop.in} $out/share/applications/sleephat-editor.desktop
  '';

  # 清理代理，根治 502
  preFixup = ''
    gappsWrapperArgs+=(
      --unset http_proxy --unset https_proxy --unset all_proxy
    )
  '';

  meta = with pkgs.lib; {
    description = "A lightweight WYSIWYG markdown editor powered by Vditor";
    homepage = "https://github.com/pachu77/markdown-editor";
    license = licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "sleephat-editor";
  };
}
