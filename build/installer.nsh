; Register Configura as an available editor, never replace another app's default.
; The per-user NSIS installer writes only to HKCU and removes only its own values.
!macro ConfiguraRegisterExtension EXT
  WriteRegStr HKCU "Software\Classes\Applications\Configura.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Configura.ConfigFile" ""
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\Configura.Edit" "" "Editar com Configura"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\Configura.Edit" "Icon" '"$INSTDIR\Configura.exe",0'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\Configura.Edit\command" "" '"$INSTDIR\Configura.exe" "%1"'
!macroend

!macro ConfiguraUnregisterExtension EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Configura.ConfigFile"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\Configura.Edit"
  DeleteRegKey /ifempty HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell"
  DeleteRegKey /ifempty HKCU "Software\Classes\SystemFileAssociations\.${EXT}"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Classes\Applications\Configura.exe" "FriendlyAppName" "Configura"
  WriteRegStr HKCU "Software\Classes\Applications\Configura.exe\DefaultIcon" "" '"$INSTDIR\Configura.exe",0'
  WriteRegStr HKCU "Software\Classes\Applications\Configura.exe\shell\open\command" "" '"$INSTDIR\Configura.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Configura.ConfigFile" "" "Arquivo de configuração"
  WriteRegStr HKCU "Software\Classes\Configura.ConfigFile\DefaultIcon" "" '"$INSTDIR\Configura.exe",0'
  WriteRegStr HKCU "Software\Classes\Configura.ConfigFile\shell\open\command" "" '"$INSTDIR\Configura.exe" "%1"'
  !insertmacro ConfiguraRegisterExtension "ini"
  !insertmacro ConfiguraRegisterExtension "cfg"
  !insertmacro ConfiguraRegisterExtension "conf"
  !insertmacro ConfiguraRegisterExtension "cnf"
  !insertmacro ConfiguraRegisterExtension "properties"
  !insertmacro ConfiguraRegisterExtension "env"
  !insertmacro ConfiguraRegisterExtension "config"
  !insertmacro ConfiguraRegisterExtension "toml"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro ConfiguraUnregisterExtension "ini"
  !insertmacro ConfiguraUnregisterExtension "cfg"
  !insertmacro ConfiguraUnregisterExtension "conf"
  !insertmacro ConfiguraUnregisterExtension "cnf"
  !insertmacro ConfiguraUnregisterExtension "properties"
  !insertmacro ConfiguraUnregisterExtension "env"
  !insertmacro ConfiguraUnregisterExtension "config"
  !insertmacro ConfiguraUnregisterExtension "toml"
  DeleteRegKey HKCU "Software\Classes\Applications\Configura.exe"
  DeleteRegKey HKCU "Software\Classes\Configura.ConfigFile"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
