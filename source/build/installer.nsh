!macro customInit
  ; 没有配置文件的安装视为全新安装：写一次性引导标记，阻止旧品牌配置迁移。
  ; 已有 config.js 的覆盖升级不写，保留原配置直接进入工作台。
  IfFileExists "$APPDATA\${PRODUCT_NAME}\config.js" freshInstallDone
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    FileOpen $0 "$APPDATA\${PRODUCT_NAME}\fresh_install.flag" w
    FileWrite $0 "1"
    FileClose $0
  freshInstallDone:
!macroend

!macro customInstall
  ; 安装版配置改存用户数据目录，清除旧版本残留在安装目录的配置
  Delete "$INSTDIR\config.js"
  Delete "$INSTDIR\first_open.flag"
!macroend
