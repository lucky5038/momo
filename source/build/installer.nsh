!macro customInstall
  ; 安装版配置改存用户数据目录，清除旧版本残留在安装目录的配置
  Delete "$INSTDIR\config.js"
  Delete "$INSTDIR\first_open.flag"
!macroend
