{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    pkg-config cargo rustc nodejs_22 cacert
  ];

  buildInputs = with pkgs; [
    webkitgtk_4_1 gtk3 librsvg libappindicator-gtk3 openssl
    gst_all_1.gstreamer
    gst_all_1.gst-plugins-base    # 提供 appsink
    gst_all_1.gst-plugins-good
    gst_all_1.gst-libav
  ];

  shellHook = ''
    export PKG_CONFIG_PATH="${pkgs.webkitgtk_4_1}/lib/pkgconfig:$PKG_CONFIG_PATH"
    export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"

    # 清理代理，防止 WebView 通过代理访问 localhost 白屏
    unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
    export no_proxy="localhost,127.0.0.1"

    echo "  🧢 Sleephat Editor 开发环境"
  '';
}
