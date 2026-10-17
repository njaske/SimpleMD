; Extra install steps for SimpleMD's Explorer integration (included via
; electron-builder's nsis.include).
;
; Windows caches an app's display name per executable path (MuiCache) and never
; refreshes it. Early builds installed to the same path reported themselves as
; "Electron", so "Open with" kept showing that name after an upgrade. Clear the
; stale cache entries and state the name explicitly so the shell shows "SimpleMD".

!define MUI_CACHE_KEY "Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"
!define MUI_CACHE_KEY_LEGACY "Software\Microsoft\Windows\Shell\MuiCache"
!define APP_KEY "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!define PROG_ID "Markdown Document"

!macro clearMuiCache
  DeleteRegValue HKCU "${MUI_CACHE_KEY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}.FriendlyAppName"
  DeleteRegValue HKCU "${MUI_CACHE_KEY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}.ApplicationCompany"
  DeleteRegValue HKCU "${MUI_CACHE_KEY_LEGACY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}.FriendlyAppName"
  DeleteRegValue HKCU "${MUI_CACHE_KEY_LEGACY}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}.ApplicationCompany"
!macroend

!macro customInstall
  !insertmacro clearMuiCache
  WriteRegStr SHELL_CONTEXT "${APP_KEY}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROG_ID}\Application" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROG_ID}\Application" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  ; SHCNE_ASSOCCHANGED: tell Explorer to reload associations and names.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro clearMuiCache
  DeleteRegValue SHELL_CONTEXT "${APP_KEY}" "FriendlyAppName"
  DeleteRegKey /ifempty SHELL_CONTEXT "${APP_KEY}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${PROG_ID}\Application"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
