[CmdletBinding()]
param(
  [ValidateSet('install','uninstall','start','stop','status')]
  [string]$Action = 'install',
  [string]$Executable = (Join-Path $PSScriptRoot 'plugmesh-server.exe'),
  [string]$Name = 'PlugmeshServer',
  [string]$EnvironmentFile = ''
)

$ErrorActionPreference = 'Stop'
$exe = [IO.Path]::GetFullPath($Executable)
$task = "Plugmesh\$Name"

switch ($Action) {
  'install' {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "plugmesh-server.exe not found: $exe" }
    $working = Split-Path -Parent $exe
    $arguments = "`"$exe`""
    if ($EnvironmentFile) { Write-Warning 'Windows scheduled tasks do not parse EnvironmentFile; use system environment variables or a wrapper.' }
    schtasks.exe /Delete /TN $task /F 2>$null | Out-Null
    schtasks.exe /Create /TN $task /SC ONLOGON /RL LIMITED /F /TR $arguments | Out-Null
    schtasks.exe /Run /TN $task | Out-Null
    Write-Output "installed and started scheduled task $task"
  }
  'uninstall' {
    schtasks.exe /End /TN $task 2>$null | Out-Null
    schtasks.exe /Delete /TN $task /F 2>$null | Out-Null
    Write-Output "removed scheduled task $task"
  }
  'start' { schtasks.exe /Run /TN $task | Out-Null }
  'stop' { schtasks.exe /End /TN $task | Out-Null }
  'status' { schtasks.exe /Query /TN $task /V /FO LIST }
}
