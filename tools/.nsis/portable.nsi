; Rainform Ultimate portable launcher - silent self-extractor
!include "FileFunc.nsh"
SilentInstall silent
OutFile "F:\Rainform-Ultimate\dist\Rainform-Ultimate-Portable-1.0.0.exe"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
Name "Rainform Ultimate Portable 1.0.0"

Section
  ${GetParameters} $R0
  StrCpy $R1 "$TEMP\RainformPortable"
  SetOutPath "$R1"
  File /r "F:\Rainform-Ultimate\app\desktop\dist\win-unpacked\*.*"
  ExecWait '"$R1\Rainform Ultimate.exe" $R0' $R2
  SetOutPath "$TEMP"
  RMDir /r "$R1"
  SetErrorLevel 0
SectionEnd
