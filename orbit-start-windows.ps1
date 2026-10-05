[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$InstallRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$OllamaUri = 'http://127.0.0.1:11434/api/tags'

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
    # Use the Windows PowerShell 5.1-compatible request API and do not let a
    # corporate/system proxy intercept loopback health checks.
    $request = $null
    $response = $null
    try {
        $request = [System.Net.WebRequest]::Create($OllamaUri)
        $request.Proxy = $null
        $request.Timeout = 2000
        $request.ReadWriteTimeout = 2000
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

function Find-Python {
    foreach ($name in @('pythonw.exe', 'python.exe')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $command -and $command.Source -notlike '*\WindowsApps\*') {
            return [pscustomobject]@{ Executable = $command.Source; PrefixArgs = @() }
        }
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += Get-ChildItem -Path (Join-Path $env:ProgramFiles 'Python*') -Filter pythonw.exe -Recurse -File -ErrorAction SilentlyContinue
        $candidates += Get-ChildItem -Path (Join-Path $env:ProgramFiles 'Python*') -Filter python.exe -Recurse -File -ErrorAction SilentlyContinue
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $candidates += Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python*') -Filter pythonw.exe -Recurse -File -ErrorAction SilentlyContinue
        $candidates += Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python*') -Filter python.exe -Recurse -File -ErrorAction SilentlyContinue
    }
    $pythonFile = $candidates | Select-Object -First 1
    if ($null -ne $pythonFile) {
        return [pscustomobject]@{ Executable = $pythonFile.FullName; PrefixArgs = @() }
    }

    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $launcher) {
        return [pscustomobject]@{ Executable = $launcher.Source; PrefixArgs = @('-3') }
    }
    return $null
}

# Runtime availability must not block the UI or an alternative LM Studio runtime.
# The watchdog retries Ollama independently after login and wake.
if (-not (Test-OllamaReady)) {
    $ollama = Find-Ollama
    if ($null -ne $ollama) {
        try {
            Start-Process -FilePath $ollama.Executable -ArgumentList @('serve') -WindowStyle Hidden | Out-Null
        } catch {
            Write-Warning "Could not start Ollama: $_. Orbit will still start."
        }
    } else {
        Write-Warning 'Ollama is unavailable. Orbit will still start; you can use LM Studio or connect Ollama later.'
    }
}

$serverPath = Join-Path $InstallRoot 'server.py'
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Orbit server file was not found: $serverPath"
}
$python = Find-Python
if ($null -eq $python) {
    throw 'Python 3 was not found. Run the Orbit installer again.'
}

$serverArguments = @($python.PrefixArgs) + @('"{0}"' -f $serverPath)
$serverProcess = Start-Process -FilePath $python.Executable -ArgumentList $serverArguments -WorkingDirectory $InstallRoot -WindowStyle Hidden -PassThru
$serverProcess.WaitForExit()
exit $serverProcess.ExitCode
