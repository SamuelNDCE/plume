; Plume: Windows "Default apps" registration (per-user, HKCU only).
; electron-builder registers the file types but not the app itself, so Settings > Apps > Default apps
; never listed Plume. This adds the Capabilities key and the RegisteredApplications entry.
; Windows does not let an app set its own default: the user still clicks "Set default" per type.
; The extension list below must stay identical to build.fileAssociations in package.json.
; ProgIDs reuse electron-builder's own association names (the "name" of each fileAssociations entry).

!macro customInstall
  WriteRegStr HKCU "Software\Plume\Capabilities" "ApplicationName" "Plume"
  WriteRegStr HKCU "Software\Plume\Capabilities" "ApplicationDescription" "Free Markdown editor and viewer"

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

  WriteRegStr HKCU "Software\Classes\Markdown document" "" "Markdown document"
  WriteRegStr HKCU "Software\Classes\Markdown document\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\Text document" "" "Text document"
  WriteRegStr HKCU "Software\Classes\Text document\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; Registration only. The user's own files and %APPDATA% data are not touched.
  DeleteRegValue HKCU "Software\RegisteredApplications" "Plume"
  DeleteRegKey HKCU "Software\Plume\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\Plume"
  DeleteRegKey HKCU "Software\Classes\Markdown document"
  DeleteRegKey HKCU "Software\Classes\Text document"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
