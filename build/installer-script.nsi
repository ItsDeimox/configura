; Configura per-user installer. This is the supported electron-builder nsis.script
; entry point. The uninstaller is emitted by WriteUninstaller on the user's PC,
; so compiling this script on Linux does not require running Windows code/Wine.
; electron-builder supplies OutFile, version resources, icons, APP_64 and plugins.

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!ifndef APP_64
  !error "Configura requires the x64 application package."
!endif
!ifndef ZIP_COMPRESSION
  !error "Use nsis.useZip=true and nsis.differentialPackage=false for this installer."
!endif

!define CONFIGURA_APP_KEY "Software\${APP_ID}"
!define CONFIGURA_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
!define CONFIGURA_EXE "Configura.exe"
!define CONFIGURA_UNINSTALLER "Uninstall Configura.exe"

Name "${PRODUCT_NAME}"
BrandingText "${PRODUCT_NAME} ${VERSION}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Configura"
InstallDirRegKey HKCU "${CONFIGURA_APP_KEY}" "InstallLocation"
ShowInstDetails show
ShowUninstDetails show
SetOverwrite on
SetDatablockOptimize on

Var installerMutex
Var alreadyLaunched
Var closeRetries

!define MUI_ABORTWARNING
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipUpdatedPage
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipUpdatedPage
!insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}\LICENSE"
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipUpdatedPage
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateInstallDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir Configura"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchConfigura
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro addLangs

Function SkipUpdatedPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
FunctionEnd

Function ValidateInstallDirectory
  ; Keep a dedicated app subfolder, even if the user selects a drive or an
  ; existing general-purpose folder. The uninstaller never owns that parent.
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "Configura"
    StrCpy $INSTDIR "$INSTDIR\Configura"
  ${EndIf}
FunctionEnd

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "O Configura precisa de Windows 10 ou 11 de 64 bits."
    SetErrorLevel 1633
    Quit
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "O Configura precisa de Windows 10 ou mais recente."
    SetErrorLevel 1633
    Quit
  ${EndIf}
  SetRegView 64
  StrCpy $LANGUAGE 1046
  StrCpy $alreadyLaunched 0
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\Configura.Install.${APP_GUID}") p .r0 ?e'
  Pop $1
  StrCpy $installerMutex $0
  ${If} $1 == 183
    MessageBox MB_OK|MB_ICONINFORMATION "Já existe um instalador do Configura aberto." /SD IDOK
    SetErrorLevel 1618
    Quit
  ${EndIf}
  Call ValidateInstallDirectory
FunctionEnd

Function WaitForConfiguraToClose
  StrCpy $closeRetries 0
  check_running:
    nsProcess::_FindProcess "${CONFIGURA_EXE}"
    Pop $0
    ${If} $0 != 0
      Return
    ${EndIf}
    ; Updates start while Electron is quitting. Give it time without killing it
    ; or bypassing the editor's unsaved-document confirmation.
    ${If} $closeRetries < 20
      IntOp $closeRetries $closeRetries + 1
      Sleep 500
      Goto check_running
    ${EndIf}
    IfSilent app_busy
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Salve seus arquivos e feche o Configura para continuar." IDRETRY retry_wait IDCANCEL app_busy
  retry_wait:
    StrCpy $closeRetries 0
    Goto check_running
  app_busy:
    SetErrorLevel 1618
    Abort "O Configura ainda está aberto. A instalação foi interrompida."
FunctionEnd

Function LaunchConfigura
  ${If} $alreadyLaunched == 1
    Return
  ${EndIf}
  StrCpy $alreadyLaunched 1
  ${If} ${isUpdated}
    Exec '"$INSTDIR\${CONFIGURA_EXE}" --updated'
  ${Else}
    Exec '"$INSTDIR\${CONFIGURA_EXE}"'
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ; electron-updater invokes --updated, optionally /S and --force-run.
  ${If} ${isForceRun}
    Call LaunchConfigura
  ${EndIf}
FunctionEnd

Section "Configura" MainSection
  AddSize ${APP_64_UNPACKED_SIZE}
  Call ValidateInstallDirectory
  Call WaitForConfiguraToClose
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  SetCompress off
  File /oname=configura-payload.zip "${APP_64}"
  SetCompress auto
  CreateDirectory "$PLUGINSDIR\configura-payload"
  nsisunz::Unzip "$PLUGINSDIR\configura-payload.zip" "$PLUGINSDIR\configura-payload"
  Pop $0
  ${If} $0 != "success"
    MessageBox MB_OK|MB_ICONSTOP "Não foi possível extrair o aplicativo.$\r$\n$0" /SD IDOK
    SetErrorLevel 1603
    Abort
  ${EndIf}
  IfFileExists "$PLUGINSDIR\configura-payload\${CONFIGURA_EXE}" payload_ready
    MessageBox MB_OK|MB_ICONSTOP "O pacote não contém o executável do Configura." /SD IDOK
    SetErrorLevel 1603
    Abort
  payload_ready:
  IfFileExists "$PLUGINSDIR\configura-payload\resources\app.asar" payload_verified
    MessageBox MB_OK|MB_ICONSTOP "O pacote do aplicativo está incompleto." /SD IDOK
    SetErrorLevel 1603
    Abort
  payload_verified:
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"
  copy_payload:
    ClearErrors
    CopyFiles /SILENT "$PLUGINSDIR\configura-payload\*.*" "$INSTDIR"
    IfErrors copy_failed copy_complete
  copy_failed:
    IfSilent install_failed
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Não foi possível copiar os arquivos. Verifique o espaço no disco, feche o Configura e tente novamente." IDRETRY copy_payload IDCANCEL install_failed
  install_failed:
    SetErrorLevel 1603
    Abort "A instalação não foi concluída. Execute novamente o instalador."
  copy_complete:
  ClearErrors
  WriteUninstaller "$INSTDIR\${CONFIGURA_UNINSTALLER}"
  IfErrors install_failed
  WriteRegStr HKCU "${CONFIGURA_APP_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "Publisher" "Deimox"
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "DisplayIcon" '"$INSTDIR\${CONFIGURA_EXE}",0'
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${CONFIGURA_UNINSTALLER}"'
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${CONFIGURA_UNINSTALLER}" /S'
  WriteRegStr HKCU "${CONFIGURA_UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/ItsDeimox/configura"
  WriteRegDWORD HKCU "${CONFIGURA_UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${CONFIGURA_UNINSTALL_KEY}" "NoRepair" 1
  !ifdef ESTIMATED_SIZE
    WriteRegDWORD HKCU "${CONFIGURA_UNINSTALL_KEY}" "EstimatedSize" ${ESTIMATED_SIZE}
  !endif
  !insertmacro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    CreateShortcut "$SMPROGRAMS\Configura.lnk" "$INSTDIR\${CONFIGURA_EXE}" "" "$INSTDIR\${CONFIGURA_EXE}" 0
    WinShell::SetLnkAUMI "$SMPROGRAMS\Configura.lnk" "${APP_ID}"
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${IfNot} ${isNoDesktopShortcut}
      ; Preserve a user's removal of the desktop shortcut across app updates.
      ${IfNot} ${isUpdated}
        CreateShortcut "$DESKTOP\Configura.lnk" "$INSTDIR\${CONFIGURA_EXE}" "" "$INSTDIR\${CONFIGURA_EXE}" 0
        WinShell::SetLnkAUMI "$DESKTOP\Configura.lnk" "${APP_ID}"
      ${EndIf}
    ${EndIf}
  !endif
  SetErrorLevel 0
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  StrCpy $LANGUAGE 1046
  ; Only remove the installation registered by this installer, never a directory
  ; containing a copied uninstaller or a changed /D argument.
  ReadRegStr $0 HKCU "${CONFIGURA_APP_KEY}" "InstallLocation"
  ${If} $0 == ""
  ${OrIf} $0 != $INSTDIR
    MessageBox MB_OK|MB_ICONSTOP "Este desinstalador não corresponde à instalação registrada do Configura." /SD IDOK
    SetErrorLevel 1603
    Quit
  ${EndIf}
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "Configura"
    SetErrorLevel 1603
    Quit
  ${EndIf}
FunctionEnd

Section "Uninstall"
  un_check_running:
    nsProcess::_FindProcess "${CONFIGURA_EXE}"
    Pop $0
    ${If} $0 == 0
      IfSilent un_busy
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Salve seus arquivos e feche o Configura antes de desinstalar." IDRETRY un_check_running IDCANCEL un_busy
    ${EndIf}
    Goto un_proceed
  un_busy:
    SetErrorLevel 1618
    Abort
  un_proceed:
  !insertmacro customUnInstall
  WinShell::UninstAppUserModelId "${APP_ID}"
  Delete "$DESKTOP\Configura.lnk"
  Delete "$SMPROGRAMS\Configura.lnk"
  DeleteRegKey HKCU "${CONFIGURA_UNINSTALL_KEY}"
  DeleteRegKey HKCU "${CONFIGURA_APP_KEY}"
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
  ; Preferences in AppData and the user's configuration files are not removed.
  SetErrorLevel 0
SectionEnd
