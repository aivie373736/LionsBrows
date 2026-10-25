; Extra NSIS steps for the Windows installer (included by electron-builder).
; Registers LionsBrows as a web browser so it appears in
; Settings > Apps > Default apps, without taking over any links by itself.

!define LB_CLIENT "Software\Clients\StartMenuInternet\LionsBrows"
!define LB_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

!macro customInstall
  WriteRegStr HKCU "${LB_CLIENT}" "" "LionsBrows"
  WriteRegStr HKCU "${LB_CLIENT}\DefaultIcon" "" "${LB_EXE},0"
  WriteRegStr HKCU "${LB_CLIENT}\shell\open\command" "" '"${LB_EXE}"'
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities" "ApplicationName" "LionsBrows"
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities" "ApplicationDescription" "A fast, private browser with vertical tabs, workspaces and a built-in ad blocker."
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities" "ApplicationIcon" "${LB_EXE},0"
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities\StartMenu" "StartMenuInternet" "LionsBrows"
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities\URLAssociations" "http" "LionsBrowsURL"
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities\URLAssociations" "https" "LionsBrowsURL"
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities\FileAssociations" ".htm" "LionsBrowsHTML"
  WriteRegStr HKCU "${LB_CLIENT}\Capabilities\FileAssociations" ".html" "LionsBrowsHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "LionsBrows" "${LB_CLIENT}\Capabilities"

  WriteRegStr HKCU "Software\Classes\LionsBrowsURL" "" "LionsBrows URL"
  WriteRegStr HKCU "Software\Classes\LionsBrowsURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\LionsBrowsURL\DefaultIcon" "" "${LB_EXE},0"
  WriteRegStr HKCU "Software\Classes\LionsBrowsURL\shell\open\command" "" '"${LB_EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\LionsBrowsHTML" "" "LionsBrows HTML Document"
  WriteRegStr HKCU "Software\Classes\LionsBrowsHTML\DefaultIcon" "" "${LB_EXE},0"
  WriteRegStr HKCU "Software\Classes\LionsBrowsHTML\shell\open\command" "" '"${LB_EXE}" "%1"'

  ; Let Windows know the list of browsers changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "${LB_CLIENT}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "LionsBrows"
  DeleteRegKey HKCU "Software\Classes\LionsBrowsURL"
  DeleteRegKey HKCU "Software\Classes\LionsBrowsHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
