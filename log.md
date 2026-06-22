```

  # 1. 看看 WebKit 子进程有没有启动                                                                   
 ./markdown-editor &                                                        
 sleep 3                                                                                             
 ps aux | grep -i webkit  
[1] 257735
pakikno+    3307  0.0  0.7 73572920 62504 ?      SLl  6月21   0:00 /nix/store/f9zsbigij2k503m6s2yqhw9pqyzhcd68-webkitgtk-2.52.4+abi=4.1/libexec/webkit2gtk-4.1/WebKitNetworkProcess 1 24
pakikno+  257760  6.8  0.8 73584636 71448 pts/2  SLl  13:11   0:00 /nix/store/f9zsbigij2k503m6s2yqhw9pqyzhcd68-webkitgtk-2.52.4+abi=4.1/libexec/webkit2gtk-4.1/WebKitNetworkProcess 1 13
pakikno+  257763  8.3  1.7 73781164 139472 pts/2 SLl  13:11   0:00 /nix/store/f9zsbigij2k503m6s2yqhw9pqyzhcd68-webkitgtk-2.52.4+abi=4.1/libexec/webkit2gtk-4.1/WebKitWebProcess 4 17
pakikno+  257848  0.0  0.0  10040  2984 pts/2    S+   13:12   0:00 grep -i webkit

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:12  
 ^C

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:12  
 # 依旧白屏

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:12  
 # 2. 试一下单进程模式（不分离 WebKit 进程）                                                         
 WEBKIT_DISABLE_SEPARATE_WEB_PROCESS=1 ./src-tauri/target/release/markdown-editor          
bash: ./src-tauri/target/release/markdown-editor: 没有那个文件或目录

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:12  
 # 2. 试一下单进程模式（不分离 WebKit 进程）                                                         
 WEBKIT_DISABLE_SEPARATE_WEB_PROCESS=1 ./src-tauri/target/release/markdown-editor        ^C

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:12  
 # 2. 试一下单进程模式（不分离 WebKit 进程）                                                         
 WEBKIT_DISABLE_SEPARATE_WEB_PROCESS=1 ./markdown-editor          
^C

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:13  
 # 也是白屏

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:13  
  # 3. 装个 Epiphany 浏览器试试 WebKit 在你的系统上能不能渲染                                         
 nix-shell -p epiphany --run epiphany 
these 2 paths will be fetched (39.0 MiB download, 184.4 MiB unpacked):
  /nix/store/playiqqd799f4fbmk46wf5yixngarn7l-epiphany-50.4
  /nix/store/iigb34ailjgjzgpc8qlywasd216q83p3-webkitgtk-2.52.4+abi=6.0
copying path '/nix/store/iigb34ailjgjzgpc8qlywasd216q83p3-webkitgtk-2.52.4+abi=6.0' from 'https://mirrors.ustc.edu.cn/nix-channels/store'...
copying path '/nix/store/playiqqd799f4fbmk46wf5yixngarn7l-epiphany-50.4' from 'https://mirrors.ustc.edu.cn/nix-channels/store'...
  🧢 Sleephat Editor 开发环境

(epiphany:259820): Adwaita-WARNING **: 13:13:41.395: Using GtkSettings:gtk-application-prefer-dark-theme with libadwaita is unsupported. Please use AdwStyleManager:color-scheme instead.

** (process:2): WARNING **: 13:13:43.006: Can't connect to a11y bus: 无法连接：没有那个文件或目录
MESA-INTEL: warning: ../src/intel/vulkan_hasvk/anv_formats.c:790: FINISHME: support more multi-planar formats with DRM modifiers
MESA-INTEL: warning: ../src/intel/vulkan_hasvk/anv_formats.c:759: FINISHME: support YUV colorspace with DRM format modifiers

** (process:2): WARNING **: 13:14:00.289: Can't connect to a11y bus: 无法连接：没有那个文件或目录

** (process:2): WARNING **: 13:14:10.696: Can't connect to a11y bus: 无法连接：没有那个文件或目录

❄️  pakiknowledge  …/src-tauri/target/release   main ✘?   13:14  
 # 浏览器可以用
```
