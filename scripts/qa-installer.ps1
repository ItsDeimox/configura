# Runs only on a disposable Windows GitHub Actions runner. No administrator access.
[CmdletBinding()]
param([string]$InstallerPath, [string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true') {
  throw 'This installer smoke test is restricted to Windows GitHub Actions runners.'
}
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
if (-not $InstallerPath) { $InstallerPath = Join-Path $project "release/Configura-Setup-$version-x64.exe" }
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not $EvidenceDirectory) { $EvidenceDirectory = Join-Path $project 'release/qa-windows' }
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$EvidenceDirectory = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
$appKey = 'Software\io.github.itsdeimox.configura'
$checks = [System.Collections.Generic.List[string]]::new()

function Get-ValueSnapshot([string]$Key, [string]$Name = '') {
  $item = $registry.OpenSubKey($Key)
  try {
    if ($null -eq $item -or $item.GetValueNames() -notcontains $Name) { return @{ Exists = $false; Value = $null; Kind = $null } }
    return @{ Exists = $true; Value = $item.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); Kind = [string]$item.GetValueKind($Name) }
  } finally { if ($item) { $item.Dispose() } }
}
function Assert-Condition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Mark-Pass([string]$Message) {
  $checks.Add($Message)
  Write-Host "PASS $Message"
}
function Assert-RegistryValue([string]$Key, [string]$Name, [string]$Expected) {
  $value = Get-ValueSnapshot $Key $Name
  Assert-Condition ($value.Exists -and $value.Value -ceq $Expected) "Unexpected registry value: HKCU\$Key [$Name]"
}
function Assert-KeyAbsent([string]$Key) {
  $item = $registry.OpenSubKey($Key)
  $exists = $null -ne $item
  if ($item) { $item.Dispose() }
  Assert-Condition (-not $exists) "Registry key was not removed: HKCU\$Key"
}
function Invoke-InstallerProcess([string]$Executable, [string[]]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit(120000)) {
    $process.Kill()
    throw "Installer process timed out: $Executable"
  }
  $process.Refresh()
  Assert-Condition ($process.ExitCode -eq 0) "Installer returned exit code $($process.ExitCode): $Executable"
}
function Wait-Until([scriptblock]$Condition, [string]$FailureMessage) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 150
  }
  throw $FailureMessage
}

Assert-KeyAbsent $appKey
$extensions = @('ini', 'cfg', 'conf', 'cnf', 'properties', 'env', 'config', 'toml')
$defaults = @{}
foreach ($extension in @('ini', 'cfg')) {
  foreach ($entry in @(@("Software\Classes\.$extension", ''), @("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$extension\UserChoice", 'ProgId'), @("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$extension\UserChoice", 'Hash'))) {
    $defaults[($entry -join '|')] = Get-ValueSnapshot $entry[0] $entry[1]
  }
}
function Assert-DefaultsPreserved {
  foreach ($key in $defaults.Keys) {
    $parts = $key.Split('|', 2)
    $before = $defaults[$key]
    $after = Get-ValueSnapshot $parts[0] $parts[1]
    Assert-Condition ($before.Exists -eq $after.Exists -and $before.Value -ceq $after.Value -and $before.Kind -ceq $after.Kind) "Default application changed: $key"
  }
}

$temporary = Join-Path $env:RUNNER_TEMP ('configura-install-qa-' + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $temporary 'Configura'
New-Item -ItemType Directory -Path $temporary | Out-Null
$sentinel = Join-Path $temporary 'parent-sentinel.txt'
$sentinelContent = [guid]::NewGuid().ToString()
[IO.File]::WriteAllText($sentinel, $sentinelContent)
$executable = Join-Path $installDir 'Configura.exe'
$uninstaller = Join-Path $installDir 'Uninstall Configura.exe'
$uninstallKey = $null
$priorExecutable = $env:CONFIGURA_QA_EXECUTABLE
$priorOutput = $env:CONFIGURA_QA_OUTPUT
$installed = $false
$uninstalled = $false
$success = $false
try {
  # NSIS /D= must be the final argument; a dedicated child folder protects the sentinel.
  Invoke-InstallerProcess $InstallerPath @('/S', "/D=$installDir")
  $installed = $true
  foreach ($file in @($executable, (Join-Path $installDir 'resources/app.asar'), (Join-Path $installDir 'resources/app-update.yml'), $uninstaller)) {
    Assert-Condition (Test-Path -LiteralPath $file -PathType Leaf) "Missing installed file: $file"
    Assert-Condition ((Get-Item -LiteralPath $file).Length -gt 0) "Empty installed file: $file"
  }
  Assert-RegistryValue $appKey 'InstallLocation' $installDir
  Mark-Pass 'silent installation creates the executable, app.asar, updater config and uninstaller'

  $command = '"' + $executable + '" "%1"'
  Assert-RegistryValue 'Software\Classes\Applications\Configura.exe\shell\open\command' '' $command
  Assert-RegistryValue 'Software\Classes\Configura.ConfigFile\shell\open\command' '' $command
  foreach ($extension in $extensions) {
    Assert-RegistryValue 'Software\Classes\Applications\Configura.exe\SupportedTypes' ".$extension" ''
    Assert-RegistryValue "Software\Classes\.$extension\OpenWithProgids" 'Configura.ConfigFile' ''
    Assert-RegistryValue "Software\Classes\SystemFileAssociations\.$extension\shell\Configura.Edit\command" '' $command
  }
  Assert-DefaultsPreserved
  Mark-Pass 'Open With and context-menu commands are exact; .ini/.cfg defaults are preserved'

  $uninstallRoot = $registry.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
  try {
    foreach ($name in $uninstallRoot.GetSubKeyNames()) {
      $entry = $uninstallRoot.OpenSubKey($name)
      try {
        if ($entry.GetValue('InstallLocation') -eq $installDir) { $uninstallKey = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$name"; break }
      } finally { $entry.Dispose() }
    }
  } finally { $uninstallRoot.Dispose() }
  Assert-Condition ($null -ne $uninstallKey) 'The installed application has no Windows uninstall entry.'
  Assert-RegistryValue $uninstallKey 'UninstallString' ('"' + $uninstaller + '"')
  Mark-Pass 'Windows uninstall entry points to the actual installed uninstaller'

  $env:CONFIGURA_QA_EXECUTABLE = $executable
  $env:CONFIGURA_QA_OUTPUT = $EvidenceDirectory
  & node (Join-Path $PSScriptRoot 'qa-native.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'The packaged Electron application failed its native smoke test.' }
  Mark-Pass 'the installed Configura.exe passes the real native file-editing smoke test'

  Invoke-InstallerProcess $uninstaller @('/S')
  Wait-Until { -not (Test-Path -LiteralPath $installDir) } 'The uninstaller did not remove its installation folder.'
  $uninstalled = $true
  Assert-KeyAbsent $appKey
  Assert-KeyAbsent $uninstallKey
  Assert-KeyAbsent 'Software\Classes\Applications\Configura.exe'
  Assert-KeyAbsent 'Software\Classes\Configura.ConfigFile'
  foreach ($extension in $extensions) {
    $value = Get-ValueSnapshot "Software\Classes\.$extension\OpenWithProgids" 'Configura.ConfigFile'
    Assert-Condition (-not $value.Exists) "Open With registration remains for .$extension"
    Assert-KeyAbsent "Software\Classes\SystemFileAssociations\.$extension\shell\Configura.Edit"
  }
  Assert-DefaultsPreserved
  Assert-Condition ((Test-Path -LiteralPath $sentinel -PathType Leaf) -and [IO.File]::ReadAllText($sentinel) -ceq $sentinelContent) 'Uninstall changed or removed the parent-folder sentinel.'
  Mark-Pass 'uninstall removes its executable and registrations while preserving defaults and parent folder'
  @{ Version = $version; Checks = $checks; InstalledExecutableTested = $true } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDirectory 'installer-qa.json') -Encoding utf8NoBOM
  $success = $true
} finally {
  $env:CONFIGURA_QA_EXECUTABLE = $priorExecutable
  $env:CONFIGURA_QA_OUTPUT = $priorOutput
  if ($installed -and -not $uninstalled -and (Test-Path -LiteralPath $uninstaller)) {
    # Only test-owned processes in this dedicated temporary installation may be stopped.
    Get-Process -Name Configura -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Stop-Process -Force -ErrorAction SilentlyContinue
    try { Invoke-InstallerProcess $uninstaller @('/S') } catch { Write-Warning "Cleanup failed: $_" }
  }
  $registry.Dispose()
  if ($success) { Remove-Item -LiteralPath $temporary -Recurse -Force }
  else { Write-Host "Installer QA evidence retained: $EvidenceDirectory ; installation: $temporary" }
}
Write-Host "Installer smoke passed: $($checks.Count) checks."
exit 0
