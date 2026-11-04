!macro customInit
  ; 仅全新安装写一次性引导标记；覆盖升级时 $INSTDIR 里已有 exe，不写。
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" freshInstallDone
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
