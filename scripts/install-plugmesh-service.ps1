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
if ($Name -notmatch '^[A-Za-z0-9._-]+$' -or $Name -in @('.', '..')) { throw "Invalid task name: $Name" }
$task = "Plugmesh-$Name"
$legacyTask = "Plugmesh\$Name"

function Invoke-Schtasks {
  param([string[]]$SchtasksArgs, [switch]$AllowFailure)
  & schtasks.exe @SchtasksArgs | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "schtasks.exe failed with exit code ${exitCode}: $($SchtasksArgs -join ' ')"
  }
}

function New-TaskXml {
  param([string]$ExecutablePath, [string]$TaskName)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $escapedUser = [Security.SecurityElement]::Escape($identity)
  $escapedPath = [Security.SecurityElement]::Escape($ExecutablePath)
  $escapedWorkingDirectory = [Security.SecurityElement]::Escape((Split-Path -Parent $ExecutablePath))
  $escapedDescription = [Security.SecurityElement]::Escape("Plugmesh server ($TaskName)")
  @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>$escapedDescription</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$escapedUser</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$escapedPath</Command>
      <WorkingDirectory>$escapedWorkingDirectory</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
}

switch ($Action) {
  'install' {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "plugmesh-server.exe not found: $exe" }
    if ($EnvironmentFile) { throw 'EnvironmentFile is not supported for Windows scheduled tasks; set per-user or system environment variables instead.' }
    $xmlPath = Join-Path $env:TEMP ("plugmesh-task-$([Guid]::NewGuid().ToString('N')).xml")
    try {
      New-TaskXml -ExecutablePath $exe -TaskName $Name | Set-Content -LiteralPath $xmlPath -Encoding Unicode
      Invoke-Schtasks -SchtasksArgs @('/Delete', '/TN', $task, '/F') -AllowFailure
      Invoke-Schtasks -SchtasksArgs @('/Delete', '/TN', $legacyTask, '/F') -AllowFailure
      Invoke-Schtasks -SchtasksArgs @('/Create', '/TN', $task, '/XML', $xmlPath, '/F')
    } finally {
      Remove-Item -LiteralPath $xmlPath -Force -ErrorAction SilentlyContinue
    }
    Invoke-Schtasks -SchtasksArgs @('/Run', '/TN', $task)
    Write-Output "installed and started restartable scheduled task $task"
  }
  'uninstall' {
    Invoke-Schtasks -SchtasksArgs @('/End', '/TN', $task) -AllowFailure
    Invoke-Schtasks -SchtasksArgs @('/Delete', '/TN', $task, '/F') -AllowFailure
    Invoke-Schtasks -SchtasksArgs @('/End', '/TN', $legacyTask) -AllowFailure
    Invoke-Schtasks -SchtasksArgs @('/Delete', '/TN', $legacyTask, '/F') -AllowFailure
    Write-Output "removed scheduled task $task"
  }
  'start' { Invoke-Schtasks -SchtasksArgs @('/Run', '/TN', $task) }
  'stop' { Invoke-Schtasks -SchtasksArgs @('/End', '/TN', $task) }
  'status' {
    & schtasks.exe /Query /TN $task /V /FO LIST
    if ($LASTEXITCODE -ne 0) { throw "schtasks.exe failed with exit code $LASTEXITCODE" }
  }
}
