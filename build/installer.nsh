; Plume: Windows registration (per-user, HKCU only). The extension list is generated from build.fileAssociations in package.json.
; Settings > Default apps lists Plume from RegisteredApplications and Capabilities.
; Open with > Choose another app lists Plume from Applications\Plume.exe (FriendlyAppName and SupportedTypes).
; Windows does not let an app set its own default: the user still picks Plume per file type.

!macro customInstall
  WriteRegStr HKCU "Software\Plume\Capabilities" "ApplicationName" "Plume"
  WriteRegStr HKCU "Software\Plume\Capabilities" "ApplicationDescription" "Plume"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".md" "Markdown document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".markdown" "Markdown document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".mdown" "Markdown document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".mkd" "Markdown document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".txt" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".log" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".out" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".err" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".csv" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".tsv" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".json" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".jsonl" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".yaml" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".yml" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".xml" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".toml" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".ini" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".cfg" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".conf" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".env" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".properties" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".sql" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".diff" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".patch" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".ps1" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".sh" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".bat" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".cmd" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".js" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".ts" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".py" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".html" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".css" "Text document"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".gitignore" "Text document"

  WriteRegStr HKCU "Software\RegisteredApplications" "Plume" "Software\Plume\Capabilities"

  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Plume"
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".markdown" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".mdown" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".mkd" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".txt" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".log" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".out" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".err" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".csv" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".tsv" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".json" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".jsonl" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".yaml" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".yml" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".xml" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".toml" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".ini" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".cfg" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".conf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".env" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".properties" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".sql" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".diff" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".patch" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".ps1" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".sh" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".bat" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".cmd" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".js" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".ts" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".py" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".html" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".css" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".gitignore" ""

  WriteRegStr HKCU "Software\Classes\Markdown document" "" "Markdown document"
  WriteRegStr HKCU "Software\Classes\Markdown document\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\Text document" "" "Text document"
  WriteRegStr HKCU "Software\Classes\Text document\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; Registration only. The user files and %APPDATA% data are not touched.
  DeleteRegValue HKCU "Software\RegisteredApplications" "Plume"
  DeleteRegKey HKCU "Software\Plume\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\Plume"
  DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey HKCU "Software\Classes\Markdown document"
  DeleteRegKey HKCU "Software\Classes\Text document"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
