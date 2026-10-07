[CmdletBinding()]
param(
    [string]$StagingRoot,
    [string]$InstallUser,
    [switch]$OllamaChecked
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$AppLabel = 'Orbit Server'
$WatchdogLabel = 'Orbit Runtime Watchdog'
$IsStaging = -not [string]::IsNullOrWhiteSpace($StagingRoot)
if ([string]::IsNullOrWhiteSpace($InstallUser)) {
    $InstallUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
}

function Write-Step([string]$Message) {
    Write-Host "Orbit: $Message"
}

function Refresh-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathParts = @($machinePath, $userPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $env:Path = $pathParts -join ';'
}

function Get-CurlCommand {
    return Get-Command curl.exe -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Invoke-HttpProbe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [string]$ExpectedText,
        [int]$TimeoutSeconds = 3
    )

    $curlCommand = Get-CurlCommand
    if ($null -ne $curlCommand) {
        $arguments = @(
            '--noproxy', '*',
            '--connect-timeout', [string][Math]::Min($TimeoutSeconds, 10),
            '--max-time', [string]$TimeoutSeconds,
            '-fsS',
            $Uri
        )
        $probe = Invoke-CurlQuietly -CurlCommand $curlCommand -Arguments $arguments
        return [pscustomobject]@{
            Success = $probe.ExitCode -eq 0 -and ([string]::IsNullOrWhiteSpace($ExpectedText) -or (($probe.Output -join "`n") -match [regex]::Escape($ExpectedText)))
        }
    }

    # Windows normally includes curl.exe, but the installer must still work
    # on stripped-down images and machines where curl is not on PATH.
    $request = $null
    $response = $null
    $reader = $null
    try {
        $request = [System.Net.WebRequest]::Create($Uri)
        $request.Proxy = $null
        $request.Timeout = $TimeoutSeconds * 1000
        $request.ReadWriteTimeout = $TimeoutSeconds * 1000
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $body = $reader.ReadToEnd()
        return [pscustomobject]@{
            Success = [string]::IsNullOrWhiteSpace($ExpectedText) -or $body.Contains($ExpectedText)
        }
    } catch {
        return [pscustomobject]@{ Success = $false }
    } finally {
        if ($null -ne $reader) {
            $reader.Dispose()
        }
        if ($null -ne $response) {
            $response.Close()
        }
    }
}

function Invoke-CurlQuietly {
    param(
        [Parameter(Mandatory = $true)]
        [object]$CurlCommand,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousErrorAction = $ErrorActionPreference
    try {
        # A non-zero curl exit code is an expected probe result when Ollama or
        # Orbit is still starting. Do not let PowerShell turn it into a
        # terminating NativeCommandError under the script's strict policy.
        $ErrorActionPreference = 'Continue'
        $output = @(& $CurlCommand.Source @Arguments 2>$null)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

function Get-OllamaCommand {
    $command = Get-Command ollama.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    # Windows may expose a Microsoft Store execution alias even when Ollama
    # is not installed. Never treat that placeholder as the real executable.
    if ($null -ne $command -and $command.Source -notlike '*\WindowsApps\*') {
        return $command
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $candidates += Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += Join-Path $env:ProgramFiles 'Ollama\ollama.exe'
    }
    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return [pscustomobject]@{ Source = $candidate }
        }
    }
    return $null
}

function Test-OllamaReady {
    return (Invoke-HttpProbe -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSeconds 2).Success
}

function Ensure-Ollama {
    if (Test-OllamaReady) {
        Write-Step 'Ollama is already running; leaving its installed models untouched.'
        return
    }

    $ollamaCommand = Get-OllamaCommand
    if ($null -eq $ollamaCommand) {
        $wingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $wingetCommand) {
            Write-Step 'Ollama was not found; installing the Ollama app without downloading a model...'
            & $wingetCommand.Source install --id Ollama.Ollama --exact --scope user --silent --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) {
                throw "Ollama installation failed with exit code $LASTEXITCODE. Install Ollama, then run this installer again."
            }
        } else {
            $chocoCommand = Get-Command choco.exe -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($null -ne $chocoCommand) {
                Write-Step 'Ollama was not found; installing the Ollama app without downloading a model...'
                & $chocoCommand.Source install ollama -y --no-progress
                if ($LASTEXITCODE -ne 0) {
                    throw "Ollama installation failed with exit code $LASTEXITCODE. Install Ollama, then run this installer again."
                }
            } else {
                throw 'Ollama was not found and no supported package manager is available. Install Ollama, then run this installer again.'
            }
        }
        Refresh-SessionPath
        $ollamaCommand = Get-OllamaCommand
        if ($null -eq $ollamaCommand) {
            throw 'Ollama was installed but could not be located. Close and reopen PowerShell, then run this installer again.'
        }
    }

    Write-Step 'Ollama is installed but not responding; starting ollama serve...'
    Start-Process -FilePath $ollamaCommand.Source -ArgumentList 'serve' -WindowStyle Hidden
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        if (Test-OllamaReady) {
            Write-Step 'Ollama is running; no model download was performed.'
            return
        }
        Start-Sleep -Seconds 1
    }
    throw 'Ollama was started but did not answer yet. Restart Ollama, then run this installer again. No model was downloaded.'
}

function Get-AdministratorState {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $IsStaging -and $null -eq (Get-CurlCommand)) {
    Write-Step 'curl.exe was not found; using the built-in PowerShell network probe instead.'
}

$ollamaCheckComplete = [bool]$OllamaChecked

function Quote-ProcessArgument([string]$Value) {
    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + $Value.Replace('"', '\"') + '"'
}

if (-not $IsStaging -and -not (Get-AdministratorState)) {
    if (-not $OllamaChecked) {
        # WinGet supports a non-admin user-scope install. If it is absent,
        # defer the check until after UAC so a Chocolatey fallback can run
        # with the administrator rights it normally requires.
        $hasOllamaCommand = $null -ne (Get-OllamaCommand)
        $hasWingetCommand = $null -ne (Get-Command winget.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($hasOllamaCommand -or $hasWingetCommand) {
            Ensure-Ollama
            $ollamaCheckComplete = $true
        }
    }
    Write-Step 'Requesting administrator access once...'
    $forwardedArguments = @(
        '-NoProfile'
        '-ExecutionPolicy'
        'Bypass'
        '-File'
        (Quote-ProcessArgument $PSCommandPath)
    )
    if ($PSBoundParameters.ContainsKey('StagingRoot')) {
        $forwardedArguments += @('-StagingRoot', (Quote-ProcessArgument $StagingRoot))
    }
    $forwardedArguments += @('-InstallUser', (Quote-ProcessArgument $InstallUser))
    if ($ollamaCheckComplete) {
        $forwardedArguments += '-OllamaChecked'
    }
    $powershellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $powershellCommand) {
        $powershellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($null -eq $powershellCommand) {
        throw 'PowerShell was not found.'
    }
    $elevated = Start-Process -FilePath $powershellCommand.Source -ArgumentList $forwardedArguments -Verb RunAs -Wait -PassThru
    exit $elevated.ExitCode
}

if ($IsStaging) {
    $StagingRoot = [IO.Path]::GetFullPath($StagingRoot)
    New-Item -ItemType Directory -Force -Path $StagingRoot | Out-Null
    $InstallRoot = Join-Path $StagingRoot 'Orbit'
    $HostsPath = Join-Path $StagingRoot 'hosts'
} else {
    $InstallRoot = Join-Path $env:ProgramFiles 'Orbit'
    $HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
}

function Stop-OrbitServerProcesses {
    if ($IsStaging) {
        return
    }
    # Reinstalling over an older task can leave its Python child alive after
    # Stop-ScheduledTask. Stop only Python processes running Orbit's server so
    # the replacement task cannot lose the HTTPS port to a stale process.
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -in @('python.exe', 'pythonw.exe') -and
        $_.CommandLine -match '(?i)\\Orbit\\server\.py(?:["\s]|$)'
    })
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

foreach ($readerAsset in @('xlsx.full.min.js', 'LICENSE')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ScriptRoot "vendor\sheetjs\$readerAsset") -PathType Leaf)) { throw "Missing spreadsheet reader: $readerAsset" }
}
$assets = @(
    'file-preview.js',
    'archives.js',
    'analyze.js',
    'document-assets.js',
    'document-edits.js', 'workspace-core.js', 'workspace-budget.js', 'document-history.js', 'workspace-tools.js',
    'long-documents.js',
    'boot.js',
    'analyze-sandbox.html',
    'analyze-worker.js',
    'chat-store.js',
    'memories.js',
    'app.js',
    'charts.js',
    'widgets.js',
    'web-tools.js',
    'thinking.js',
    'voice.js',
    'usage.js',
    'widgets-ui.js',
    'icon.svg',
    'index.html',
    'manifest.webmanifest',
    'orbit-start-windows.ps1',
    'orbit-watchdog-windows.ps1',
    'server.py',
    'gemini.py',
    'openai_gateway.py', 'deepseek.py',
    'aicredits.py',
    'service-worker.js',
    'styles.css'
)

foreach ($asset in $assets) {
    $source = Join-Path $ScriptRoot $asset
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing Orbit file: $asset"
    }
}
foreach ($readerAsset in @('pdf.min.mjs', 'pdf.worker.min.mjs', 'mammoth.browser.min.js', 'jszip.min.js', 'PDFJS-LICENSE', 'MAMMOTH-LICENSE', 'JSZIP-LICENSE')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ScriptRoot "vendor\readers\$readerAsset") -PathType Leaf)) { throw "Missing bundled document reader: $readerAsset" }
}
$vendorSource = Join-Path $ScriptRoot 'vendor\katex'
$widgetAssets = @('engine.js', 'LICENSES.txt', 'ROBOTO-LICENSE.txt')
foreach ($widgetAsset in $widgetAssets) {
    if (-not (Test-Path -LiteralPath (Join-Path $ScriptRoot "vendor\widgets\$widgetAsset") -PathType Leaf)) {
        throw "Missing bundled widget asset: $widgetAsset"
    }
}
if (-not (Test-Path -LiteralPath $vendorSource -PathType Container)) {
    throw 'Missing Orbit vendor directory: vendor\katex'
}
$vendorAssets = @(Get-ChildItem -LiteralPath $vendorSource -File)
if ($vendorAssets.Count -eq 0) {
    throw 'Missing bundled KaTeX assets.'
}

# Keep the installer health check tied to the asset actually shipped in
# index.html so a frontend cache-bust never makes a healthy install look bad.
$indexHtml = Get-Content -LiteralPath (Join-Path $ScriptRoot 'index.html') -Raw
$expectedAppAssetMatch = [regex]::Match($indexHtml, 'boot\.js\?v=[^"''\s]+')
if (-not $expectedAppAssetMatch.Success) {
    throw 'Could not determine the Orbit app asset version from index.html.'
}
$ExpectedAppAsset = $expectedAppAssetMatch.Value

# Validate the complete payload before interrupting a working installation.
if (-not $IsStaging) {
    $stoppedExistingTask = $false
    foreach ($taskName in @($AppLabel, $WatchdogLabel)) {
        $previousTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($null -ne $previousTask) {
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            $stoppedExistingTask = $true
        }
    }
    if ($stoppedExistingTask) { Start-Sleep -Milliseconds 500 }
    Stop-OrbitServerProcesses
}

function Get-PythonRuntime {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $pythonCommand -and $pythonCommand.Source -notlike '*\WindowsApps\*') {
        return [pscustomobject]@{
            Executable = $pythonCommand.Source
            PrefixArgs = @()
        }
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += Get-ChildItem -Path (Join-Path $env:ProgramFiles 'Python*') -Filter python.exe -Recurse -File -ErrorAction SilentlyContinue
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LocalAppData)) {
        $candidates += Get-ChildItem -Path (Join-Path $env:LocalAppData 'Programs\Python\Python*') -Filter python.exe -Recurse -File -ErrorAction SilentlyContinue
    }
    $pythonFile = $candidates | Select-Object -First 1
    if ($null -ne $pythonFile) {
        return [pscustomobject]@{
            Executable = $pythonFile.FullName
            PrefixArgs = @()
        }
    }

    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $launcher) {
        return [pscustomobject]@{
            Executable = $launcher.Source
            PrefixArgs = @('-3')
        }
    }
    return $null
}

$pythonRuntime = Get-PythonRuntime
if ($null -eq $pythonRuntime) {
    if ($IsStaging) {
        throw 'The isolated Windows staging test needs Python 3. Install Python 3, then run the staging test again.'
    }
    $wingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $wingetCommand) {
        throw 'Python 3 was not found and winget is unavailable. Install Python 3, then run this installer again.'
    }
    Write-Step 'Python 3 was not found; installing it with winget...'
    & $wingetCommand.Source install --id Python.Python.3.13 --exact --scope machine --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Python installation failed with exit code $LASTEXITCODE."
    }
    Refresh-SessionPath
    $pythonRuntime = Get-PythonRuntime
}
if ($null -eq $pythonRuntime) {
    throw 'Python 3 could not be located after installation.'
}

Write-Step 'Preparing offline Analyze Python and math packages...'
& $pythonRuntime.Executable @($pythonRuntime.PrefixArgs) (Join-Path $ScriptRoot 'scripts\setup-analyze.py')
if ($LASTEXITCODE -ne 0) { throw 'Offline Analyze setup failed. Check the internet connection and rerun the installer.' }

Write-Step "Copying Orbit to $InstallRoot"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
foreach ($asset in $assets) {
    Copy-Item -LiteralPath (Join-Path $ScriptRoot $asset) -Destination (Join-Path $InstallRoot $asset) -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'vendor\katex') | Out-Null
foreach ($vendorAsset in $vendorAssets) {
    Copy-Item -LiteralPath $vendorAsset.FullName -Destination (Join-Path $InstallRoot 'vendor\katex') -Force
}

New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'vendor\widgets') | Out-Null
Copy-Item -Path (Join-Path $ScriptRoot 'vendor\widgets\*') -Destination (Join-Path $InstallRoot 'vendor\widgets') -Recurse -Force

if (-not $IsStaging -and -not $OllamaChecked) {
    Ensure-Ollama
}

New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'vendor\analyze') | Out-Null
Copy-Item -Path (Join-Path $ScriptRoot 'vendor\analyze\*') -Destination (Join-Path $InstallRoot 'vendor\analyze') -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'vendor\readers') | Out-Null
Copy-Item -Path (Join-Path $ScriptRoot 'vendor\readers\*') -Destination (Join-Path $InstallRoot 'vendor\readers') -Recurse -Force

New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'vendor\sheetjs') | Out-Null
foreach ($readerAsset in @('xlsx.full.min.js', 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path $ScriptRoot "vendor\sheetjs\$readerAsset") -Destination (Join-Path $InstallRoot "vendor\sheetjs\$readerAsset") -Force
}
$certFile = Join-Path $InstallRoot 'orbit.com.pem'
$keyFile = Join-Path $InstallRoot 'orbit.com-key.pem'
$certificateBackupRoot = Join-Path $InstallRoot '.orbit-cert-backup'
if (Test-Path -LiteralPath $certificateBackupRoot) {
    $staleBackupCertificate = Join-Path $certificateBackupRoot 'orbit.com.pem'
    $staleBackupKey = Join-Path $certificateBackupRoot 'orbit.com-key.pem'
    $hasStaleCertificate = Test-Path -LiteralPath $staleBackupCertificate -PathType Leaf
    $hasStaleKey = Test-Path -LiteralPath $staleBackupKey -PathType Leaf
    if ($hasStaleCertificate -xor $hasStaleKey) {
        throw 'An incomplete Orbit certificate backup was found. The previous install was not changed; remove .orbit-cert-backup after verifying the existing certificate pair, then run this installer again.'
    }
    if ($hasStaleCertificate -and $hasStaleKey) {
        Write-Step 'Recovering the previous Orbit certificate pair before continuing...'
        if (Test-Path -LiteralPath $certFile) {
            Remove-Item -LiteralPath $certFile -Force
        }
        if (Test-Path -LiteralPath $keyFile) {
            Remove-Item -LiteralPath $keyFile -Force
        }
        Move-Item -LiteralPath $staleBackupCertificate -Destination $certFile -Force
        Move-Item -LiteralPath $staleBackupKey -Destination $keyFile -Force
    }
    Remove-Item -LiteralPath $certificateBackupRoot -Recurse -Force
}

$certificateWorkRoot = Join-Path $InstallRoot '.orbit-cert-work'
if (Test-Path -LiteralPath $certificateWorkRoot) {
    Remove-Item -LiteralPath $certificateWorkRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $certificateWorkRoot | Out-Null
$certificateTempFile = Join-Path $certificateWorkRoot 'orbit.com.pem'
$keyTempFile = Join-Path $certificateWorkRoot 'orbit.com-key.pem'

$script:OrbitCertificateBackedUp = $false
$script:OrbitKeyBackedUp = $false
$script:OrbitNewCertificateInstalled = $false
$script:OrbitNewKeyInstalled = $false

function Restore-OrbitCertificatePair {
    if ($script:OrbitNewCertificateInstalled -and (Test-Path -LiteralPath $certFile)) {
        Remove-Item -LiteralPath $certFile -Force
        $script:OrbitNewCertificateInstalled = $false
    }
    if ($script:OrbitNewKeyInstalled -and (Test-Path -LiteralPath $keyFile)) {
        Remove-Item -LiteralPath $keyFile -Force
        $script:OrbitNewKeyInstalled = $false
    }
    if ($script:OrbitCertificateBackedUp -and (Test-Path -LiteralPath (Join-Path $certificateBackupRoot 'orbit.com.pem'))) {
        Move-Item -LiteralPath (Join-Path $certificateBackupRoot 'orbit.com.pem') -Destination $certFile -Force
        $script:OrbitCertificateBackedUp = $false
    }
    if ($script:OrbitKeyBackedUp -and (Test-Path -LiteralPath (Join-Path $certificateBackupRoot 'orbit.com-key.pem'))) {
        Move-Item -LiteralPath (Join-Path $certificateBackupRoot 'orbit.com-key.pem') -Destination $keyFile -Force
        $script:OrbitKeyBackedUp = $false
    }
}

try {
if ($IsStaging) {
    $mkcertCommand = Get-Command mkcert.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $mkcertCommand) {
        throw 'The isolated Windows staging test needs mkcert.exe. The normal installer installs mkcert when it is missing.'
    }
    Write-Step 'Creating the isolated staging HTTPS certificate...'
    & $mkcertCommand.Source -cert-file $certificateTempFile -key-file $keyTempFile orbit.com localhost 127.0.0.1 ::1
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit staging certificate creation failed with exit code $LASTEXITCODE."
    }
} else {
    $mkcertCommand = Get-Command mkcert.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $mkcertCommand) {
        $wingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $wingetCommand) {
            Write-Step 'Installing mkcert for a trusted local HTTPS certificate...'
            & $wingetCommand.Source install --id FiloSottile.mkcert --exact --scope machine --silent --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) {
                throw "mkcert installation failed with exit code $LASTEXITCODE."
            }
        } else {
            $chocoCommand = Get-Command choco.exe -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($null -ne $chocoCommand) {
                Write-Step 'Installing mkcert for a trusted local HTTPS certificate...'
                & $chocoCommand.Source install mkcert -y --no-progress
                if ($LASTEXITCODE -ne 0) {
                throw "mkcert installation failed with exit code $LASTEXITCODE."
            }
            } else {
                throw 'mkcert and a package manager were not found. Install mkcert, then run this installer again.'
            }
        }
        Refresh-SessionPath
        $mkcertCommand = Get-Command mkcert.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($null -eq $mkcertCommand) {
        throw 'mkcert could not be located after installation.'
    }

    Write-Step 'Creating and trusting the Orbit HTTPS certificate...'
    & $mkcertCommand.Source -install
    if ($LASTEXITCODE -ne 0) {
        throw "mkcert trust-store setup failed with exit code $LASTEXITCODE."
    }
    & $mkcertCommand.Source -cert-file $certificateTempFile -key-file $keyTempFile orbit.com localhost 127.0.0.1 ::1
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit certificate creation failed with exit code $LASTEXITCODE."
    }
}
if (-not (Test-Path -LiteralPath $certificateTempFile -PathType Leaf) -or -not (Test-Path -LiteralPath $keyTempFile -PathType Leaf)) {
    throw 'The HTTPS certificate files were not created.'
}
} catch {
    if (Test-Path -LiteralPath $certificateWorkRoot) {
        Remove-Item -LiteralPath $certificateWorkRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
}
$replacementSucceeded = $false
try {
    New-Item -ItemType Directory -Force -Path $certificateBackupRoot | Out-Null
    if (Test-Path -LiteralPath $certFile) {
        Move-Item -LiteralPath $certFile -Destination (Join-Path $certificateBackupRoot 'orbit.com.pem') -Force
        $script:OrbitCertificateBackedUp = $true
    }
    if (Test-Path -LiteralPath $keyFile) {
        Move-Item -LiteralPath $keyFile -Destination (Join-Path $certificateBackupRoot 'orbit.com-key.pem') -Force
        $script:OrbitKeyBackedUp = $true
    }
    Move-Item -LiteralPath $certificateTempFile -Destination $certFile -Force
    $script:OrbitNewCertificateInstalled = $true
    Move-Item -LiteralPath $keyTempFile -Destination $keyFile -Force
    $script:OrbitNewKeyInstalled = $true
    $replacementSucceeded = $true
} catch {
    try {
        Restore-OrbitCertificatePair
    } catch {
        throw "Orbit certificate replacement failed and the previous pair could not be restored. Preserve $certificateBackupRoot and inspect it before retrying. Original error: $($_.Exception.Message)"
    }
    throw
} finally {
    if (Test-Path -LiteralPath $certificateWorkRoot) {
        Remove-Item -LiteralPath $certificateWorkRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($replacementSucceeded -and (Test-Path -LiteralPath $certificateBackupRoot)) {
        Remove-Item -LiteralPath $certificateBackupRoot -Recurse -Force
    }
}

if (-not $IsStaging) {
    Write-Step 'Restricting access to the private certificate key...'
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $keyFile /inheritance:r /grant:r ("{0}:R" -f $currentUser) 'SYSTEM:F' 'Administrators:F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not secure the Orbit certificate key.'
    }
}

Write-Step 'Mapping orbit.com to local IPv4 and IPv6 loopback...'
if (-not (Test-Path -LiteralPath $HostsPath)) {
    New-Item -ItemType File -Force -Path $HostsPath | Out-Null
}
$hostLines = @(Get-Content -LiteralPath $HostsPath)
$normalizedHostLines = @()
foreach ($line in $hostLines) {
    if ($line -match '^\s*#\s*Orbit local domain\s*$') {
        continue
    }
    $parts = $line -split '#', 2
    $hostPart = $parts[0]
    $comment = if ($parts.Count -gt 1) { '#' + $parts[1] } else { $null }
    $tokens = @($hostPart -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $hasOrbitHost = @($tokens | Where-Object { $_ -match '^(?i:orbit\.com)\.?$' }).Count -gt 0
    if (-not $hasOrbitHost) {
        $normalizedHostLines += $line
        continue
    }
    $keptTokens = @($tokens | Where-Object { $_ -notmatch '^(?i:orbit\.com)\.?$' })
    $hostNames = @($keptTokens | Where-Object {
        $_ -notmatch '^(?:\d{1,3}\.){3}\d{1,3}$' -and $_ -notmatch '^[0-9A-Fa-f:]+$'
    })
    if ($hostNames.Count -gt 0) {
        $normalizedLine = $keptTokens -join ' '
        if (-not [string]::IsNullOrWhiteSpace($comment)) {
            $normalizedLine += " $($comment.Trim())"
        }
        $normalizedHostLines += $normalizedLine
    }
}
$normalizedHostLines += @('', '# Orbit local domain', '127.0.0.1 orbit.com', '::1 orbit.com')
[IO.File]::WriteAllLines($HostsPath, $normalizedHostLines, [Text.Encoding]::ASCII)
if (-not $IsStaging) {
    & ipconfig.exe /flushdns | Out-Null
}

$serverBootstrapPath = Join-Path $InstallRoot 'orbit-start-windows.ps1'
$taskPowerShell = Get-Command powershell.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $taskPowerShell) {
    $taskPowerShell = Get-Command pwsh.exe -ErrorAction SilentlyContinue | Select-Object -First 1
}
if ($null -eq $taskPowerShell) {
    throw 'PowerShell was not found for the Orbit startup task.'
}
$taskArgumentParts = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $serverBootstrapPath)
$taskArguments = ($taskArgumentParts | ForEach-Object { '"{0}"' -f $_ }) -join ' '

if ($IsStaging) {
    $taskDescription = Join-Path $StagingRoot 'orbit-task.txt'
    @(
        "Executable: $($taskPowerShell.Source)"
        "Arguments: $taskArguments"
        "WorkingDirectory: $InstallRoot"
        "Certificate: $certFile"
        "Watchdog: $WatchdogLabel"
        "WatchdogScript: $(Join-Path $InstallRoot 'orbit-watchdog-windows.ps1')"
    ) | Set-Content -LiteralPath $taskDescription -Encoding utf8
    Write-Host ''
    Write-Host "Staged Orbit install created at: $InstallRoot"
    Write-Host "Staged hosts file: $HostsPath"
    Write-Host "Staged task description: $taskDescription"
    exit 0
}

Write-Step 'Registering Orbit to start automatically at user logon...'
$action = New-ScheduledTaskAction -Execute $taskPowerShell.Source -Argument $taskArguments -WorkingDirectory $InstallRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $InstallUser -LogonType Interactive -RunLevel Highest
$existingTask = Get-ScheduledTask -TaskName $AppLabel -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    Stop-ScheduledTask -TaskName $AppLabel -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}
Stop-OrbitServerProcesses
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $AppLabel -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Orbit local HTTPS server' -Force | Out-Null
Start-ScheduledTask -TaskName $AppLabel

Write-Step 'Registering the runtime watchdog for startup, wake, and recovery...'
$watchdogPath = Join-Path $InstallRoot 'orbit-watchdog-windows.ps1'
$watchdogArgumentParts = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $watchdogPath)
$watchdogArguments = ($watchdogArgumentParts | ForEach-Object { '"{0}"' -f $_ }) -join ' '
$watchdogAction = New-ScheduledTaskAction -Execute $taskPowerShell.Source -Argument $watchdogArguments -WorkingDirectory $InstallRoot
$watchdogAtStartup = New-ScheduledTaskTrigger -AtStartup
$watchdogAtLogOn = New-ScheduledTaskTrigger -AtLogOn
$watchdogRepeating = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$watchdogSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $WatchdogLabel -Action $watchdogAction -Trigger @($watchdogAtStartup, $watchdogAtLogOn, $watchdogRepeating) -Principal $principal -Settings $watchdogSettings -Description 'Orbit Ollama and HTTPS runtime recovery' -Force | Out-Null

function Test-OrbitEndpoint([string]$Address) {
    $curlCommand = Get-CurlCommand
    if ($null -eq $curlCommand) {
        # Without curl, let the OS resolve orbit.com from the hosts file. The
        # fallback cannot force one IP family, but it still verifies the
        # trusted HTTPS service without making curl a hard dependency.
        return (Invoke-HttpProbe -Uri 'https://orbit.com/index.html' -ExpectedText $ExpectedAppAsset -TimeoutSeconds 3).Success
    }
    $resolve = "orbit.com:443:$Address"
    $probe = Invoke-CurlQuietly -CurlCommand $curlCommand -Arguments @(
        '--noproxy', '*',
        # Local mkcert certificates do not have a public revocation endpoint;
        # Schannel otherwise fails the probe with CRYPT_E_NO_REVOCATION_CHECK.
        '--ssl-no-revoke',
        '-fsS',
        '--connect-timeout', '1',
        '--max-time', '3',
        '--resolve', $resolve,
        'https://orbit.com/index.html'
    )
    if ($probe.ExitCode -ne 0) {
        return $false
    }
    return [bool]($probe.Output -match [regex]::Escape($ExpectedAppAsset))
}

Write-Step 'Waiting for Orbit to answer on HTTPS...'
$healthyIpv4 = $false
$healthyIpv6 = $false
for ($attempt = 1; $attempt -le 10; $attempt++) {
    $healthyIpv4 = Test-OrbitEndpoint '127.0.0.1'
    $healthyIpv6 = Test-OrbitEndpoint '[::1]'
    if ($healthyIpv4 -and $healthyIpv6) {
        break
    }
    Start-Sleep -Seconds 1
}

if (-not ($healthyIpv4 -and $healthyIpv6)) {
    throw 'Orbit was installed, but its trusted HTTPS server did not answer over both IPv4 and IPv6 yet. Check the "Orbit Server" task in Task Scheduler.'
}

Start-ScheduledTask -TaskName $WatchdogLabel
# Preserve source certificates: another installation may still use this folder.

Write-Host ''
Write-Host 'Orbit is installed. Open https://orbit.com'
