[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$InstallRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$OllamaUri = 'http://127.0.0.1:11434/api/tags'
$OrbitBootstrap = Join-Path $InstallRoot 'orbit-start-windows.ps1'

function Find-Ollama {
    $command = Get-Command ollama.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command -and $command.Source -notlike '*\WindowsApps\*') {
        return [pscustomobject]@{ Executable = $command.Source }
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $candidates += Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += Join-Path $env:ProgramFiles 'Ollama\ollama.exe'
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [pscustomobject]@{ Executable = $candidate }
        }
    }
    return $null
}

function Test-OllamaReady {
    return (Invoke-PowerShellHttpProbe -Uri $OllamaUri -TimeoutMilliseconds 2000)
}

function Invoke-PowerShellHttpProbe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [int]$TimeoutMilliseconds = 3000
    )

    $request = $null
    $response = $null
    try {
        $request = [System.Net.WebRequest]::Create($Uri)
        $request.Proxy = $null
        $request.Timeout = $TimeoutMilliseconds
        $request.ReadWriteTimeout = $TimeoutMilliseconds
        $response = $request.GetResponse()
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $response) {
            $response.Close()
        }
    }
}

function Start-OllamaIfNeeded {
    if (Test-OllamaReady) {
        return $true
    }
    $ollama = Find-Ollama
    if ($null -eq $ollama) {
        return $false
    }
    Start-Process -FilePath $ollama.Executable -ArgumentList @('serve') -WindowStyle Hidden | Out-Null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        if (Test-OllamaReady) {
            return $true
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Get-CurlCommand {
    return Get-Command curl.exe -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Test-OrbitEndpoint([string]$Address) {
    $curlCommand = Get-CurlCommand
    if ($null -eq $curlCommand) {
        # Let the hosts file resolve orbit.com when curl is unavailable. This
        # intentionally checks service availability without making curl a
        # runtime dependency on stripped-down Windows images.
        return (Invoke-PowerShellHttpProbe -Uri 'https://orbit.com/index.html' -TimeoutMilliseconds 3000)
    }
    $resolve = "orbit.com:443:$Address"
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $curlCommand.Source '--noproxy' '*' '--ssl-no-revoke' '-fsS' '--connect-timeout' '1' '--max-time' '3' '--resolve' $resolve 'https://orbit.com/index.html' '-o' 'NUL' 2>$null
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

function Test-OrbitReady {
    # Treat either local IP family as sufficient for recovery. This avoids
    # restarting a healthy server just because a machine has IPv6 disabled.
    return (Test-OrbitEndpoint '127.0.0.1') -or (Test-OrbitEndpoint '[::1]')
}

function Stop-OrbitServerProcesses {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -in @('python.exe', 'pythonw.exe') -and
        $_.CommandLine -match '(?i)\\Orbit\\server\.py(?:["\s]|$)'
    })
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-OrbitIfNeeded {
    if (Test-OrbitReady) {
        return
    }
    if (-not (Test-Path -LiteralPath $OrbitBootstrap -PathType Leaf)) {
        return
    }
    Stop-OrbitServerProcesses
    $powershell = Get-Command powershell.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $powershell) {
        $powershell = Get-Command pwsh.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($null -eq $powershell) {
        return
    }
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"{0}"' -f $OrbitBootstrap))
    Start-Process -FilePath $powershell.Source -ArgumentList $arguments -WorkingDirectory $InstallRoot -WindowStyle Hidden | Out-Null
}

# This exits quickly when everything is healthy. The scheduled task repeats
# it after login, startup, wake-from-sleep, and at a low one-minute cadence.
Start-OllamaIfNeeded | Out-Null
Start-OrbitIfNeeded
