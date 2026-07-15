[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [Parameter(Mandatory = $false)]
    [string]$XinYinPath,

    [Parameter(Mandatory = $false)]
    [string]$ToolsPath
)

$ErrorActionPreference = 'Stop'

function Resolve-ExistingPath {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    if (-not (Test-Path -LiteralPath $PathValue)) {
        return $null
    }

    return (Resolve-Path -LiteralPath $PathValue).Path
}

function Find-CommandPath {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        return $null
    }

    return $command.Source
}

$resolvedBackup = Resolve-ExistingPath $BackupPath
if ($null -eq $resolvedBackup) {
    throw "Backup path does not exist: $BackupPath"
}

$backupItem = Get-Item -LiteralPath $resolvedBackup
if (-not $backupItem.PSIsContainer) {
    throw "Backup path must be a directory: $resolvedBackup"
}

$backupFiles = @(Get-ChildItem -LiteralPath $resolvedBackup -Recurse -File -Force -ErrorAction Stop)
$backupBytes = ($backupFiles | Measure-Object -Property Length -Sum).Sum
if ($null -eq $backupBytes) {
    $backupBytes = 0
}

$latestWrite = $backupFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1 -ExpandProperty LastWriteTimeUtc
$backupRoot = [System.IO.Path]::GetPathRoot($resolvedBackup)
$driveName = $backupRoot.TrimEnd('\').TrimEnd(':')
$drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
$freeBytes = if ($null -ne $drive) { [int64]$drive.Free } else { 0 }

$programFilesX86 = ${env:ProgramFiles(x86)}
$mumuRoots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
[void]$mumuRoots.Add("$env:ProgramFiles\Netease\MuMuPlayer-12.0")
if ($programFilesX86) {
    [void]$mumuRoots.Add("$programFilesX86\Netease\MuMuPlayer-12.0")
}

Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'MuMu|Nemu|MuMuVMM' } |
    ForEach-Object {
        try {
            $processDirectory = Split-Path -Parent $_.Path
            if ((Split-Path -Leaf $processDirectory) -eq 'shell') {
                [void]$mumuRoots.Add((Split-Path -Parent $processDirectory))
            }
        }
        catch {
            # Some protected processes do not expose Path; continue read-only discovery.
        }
    }

$uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

foreach ($uninstallRoot in $uninstallRoots) {
    Get-ItemProperty -Path $uninstallRoot -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -match 'MuMu|Nemu' } |
        ForEach-Object {
            if ($_.InstallLocation -and (Test-Path -LiteralPath $_.InstallLocation)) {
                [void]$mumuRoots.Add([System.IO.Path]::GetFullPath($_.InstallLocation))
            }
            elseif ($_.DisplayIcon) {
                $iconPath = ($_.DisplayIcon -replace '^"|"$','').Split(',')[0]
                if (Test-Path -LiteralPath $iconPath) {
                    $iconDirectory = Split-Path -Parent $iconPath
                    [void]$mumuRoots.Add((Split-Path -Parent $iconDirectory))
                }
            }
        }
}

$mumuCandidates = @(
    foreach ($mumuRoot in $mumuRoots) {
        "$mumuRoot\shell\MuMuManager.exe"
        "$mumuRoot\shell\adb.exe"
    }
) | Where-Object { Test-Path -LiteralPath $_ } | Sort-Object -Unique

$adbPath = Find-CommandPath 'adb'
$ollamaPath = Find-CommandPath 'ollama'
$resolvedXinYin = Resolve-ExistingPath $XinYinPath
$resolvedTools = Resolve-ExistingPath $ToolsPath

$requiredFree = [Math]::Max([int64](5GB), [int64]($backupBytes * 3))
$spaceStatus = if ($freeBytes -ge $requiredFree) { 'OK' } else { 'LOW' }

$rows = @(
    [PSCustomObject]@{ Check = 'BackupPath'; Status = 'OK'; Detail = $resolvedBackup },
    [PSCustomObject]@{ Check = 'BackupFiles'; Status = if ($backupFiles.Count -gt 0) { 'OK' } else { 'EMPTY' }; Detail = "Files=$($backupFiles.Count); Bytes=$backupBytes; LatestUtc=$latestWrite" },
    [PSCustomObject]@{ Check = 'FreeSpace'; Status = $spaceStatus; Detail = "Drive=$backupRoot; FreeBytes=$freeBytes; SuggestedBytes=$requiredFree" },
    [PSCustomObject]@{ Check = 'MuMuTools'; Status = if ($mumuCandidates.Count -gt 0) { 'FOUND' } else { 'NOT_FOUND' }; Detail = ($mumuCandidates -join '; ') },
    [PSCustomObject]@{ Check = 'ADB'; Status = if ($adbPath) { 'FOUND' } else { 'NOT_ON_PATH' }; Detail = $adbPath },
    [PSCustomObject]@{ Check = 'Ollama'; Status = if ($ollamaPath) { 'FOUND' } else { 'NOT_ON_PATH' }; Detail = $ollamaPath },
    [PSCustomObject]@{ Check = 'XinYin'; Status = if ([string]::IsNullOrWhiteSpace($XinYinPath)) { 'NOT_PROVIDED' } elseif ($resolvedXinYin) { 'FOUND' } else { 'NOT_FOUND' }; Detail = $resolvedXinYin },
    [PSCustomObject]@{ Check = 'ToolsPath'; Status = if ([string]::IsNullOrWhiteSpace($ToolsPath)) { 'NOT_PROVIDED' } elseif ($resolvedTools) { 'FOUND' } else { 'NOT_FOUND' }; Detail = $resolvedTools }
)

$rows | Format-Table -AutoSize -Wrap

if ($backupFiles.Count -eq 0) {
    exit 2
}

if ($spaceStatus -ne 'OK') {
    exit 3
}

exit 0
