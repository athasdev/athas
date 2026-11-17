; Explorer context menu entries for opening files and folders in Athas.
; On Windows 11 they appear under "Show more options".

!macro ATHAS_CONTEXT_MENU KEY TARGET
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\Athas" "" "Open with ${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\Athas" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\Athas\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"${TARGET}$\""
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro ATHAS_CONTEXT_MENU "*" "%1"
  !insertmacro ATHAS_CONTEXT_MENU "Directory" "%1"
  !insertmacro ATHAS_CONTEXT_MENU "Directory\Background" "%V"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey SHCTX "Software\Classes\*\shell\Athas"
    DeleteRegKey SHCTX "Software\Classes\Directory\shell\Athas"
    DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\Athas"
  ${EndIf}
!macroend
