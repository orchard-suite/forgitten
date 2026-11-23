# Forgitten Installer for Windows
# Install:   irm https://raw.githubusercontent.com/orchard-suite/forgitten/main/install.ps1 | iex
# Uninstall: & ([scriptblock]::Create((irm https://raw.githubusercontent.com/orchard-suite/forgitten/main/install.ps1))) -Uninstall

#Requires -Version 5.1

param(
    [switch]$Uninstall,
    [string]$Version,
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$script:Repo = "orchard-suite/forgitten"
$script:BinaryName = "forgitten.exe"

# Default install location
if (-not $InstallDir) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\forgitten"
}

function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Green }
function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }

# Throws rather than exits: run through `irm | iex`, exit would close the
# PowerShell window it was typed into.
function Write-Err { param($Message) throw "[ERROR] $Message" }

function Get-Architecture {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64"   { return "x64" }
        "Arm64" { return "arm64" }
        default { Write-Err "Unsupported architecture: $arch" }
    }
}

function Get-LatestVersion {
    try {
        $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$script:Repo/releases/latest" -UseBasicParsing
        return $response.tag_name
    }
    catch {
        return $null
    }
}

function Get-UserPath {
    $current = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $current) { return @() }
    return @($current -split ";" | Where-Object { $_ })
}

function Add-ToPath {
    param($Directory)

    $entries = Get-UserPath
    if ($entries -notcontains $Directory) {
        [Environment]::SetEnvironmentVariable("Path", (($entries + $Directory) -join ";"), "User")
        $env:Path = "$env:Path;$Directory"
        Write-Info "Added $Directory to PATH"
    }
}

function Remove-FromPath {
    param($Directory)

    $entries = Get-UserPath
    if ($entries -contains $Directory) {
        [Environment]::SetEnvironmentVariable("Path", (($entries | Where-Object { $_ -ne $Directory }) -join ";"), "User")
        Write-Info "Removed $Directory from PATH"
    }
}

function Uninstall-Forgitten {
    Write-Info "Uninstalling forgitten..."

    $binaryPath = Join-Path $InstallDir $script:BinaryName

    if (Test-Path $binaryPath) {
        Remove-Item $binaryPath -Force
        Write-Info "Removed $binaryPath"
    }
    else {
        Write-Warn "forgitten not found in $InstallDir"
    }

    if (Test-Path $InstallDir) {
        $remaining = Get-ChildItem $InstallDir
        if ($remaining.Count -eq 0) {
            Remove-Item $InstallDir -Force
            Write-Info "Removed $InstallDir"
        }
    }

    Remove-FromPath $InstallDir

    Write-Info "Uninstall complete"
}

function Install-Forgitten {
    $arch = Get-Architecture

    if (-not $Version) {
        $Version = Get-LatestVersion
    }

    if (-not $Version) {
        Write-Err "Could not determine latest version. Specify -Version parameter."
    }

    Write-Info "Installing forgitten $Version for win-$arch..."

    $assetName = "forgitten-win-$arch.exe"
    $releaseUrl = "https://github.com/$script:Repo/releases/download/$Version"

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        # Download binary
        $download = Join-Path $tempDir $script:BinaryName
        Write-Info "Downloading from $releaseUrl/$assetName..."
        try {
            Invoke-WebRequest -Uri "$releaseUrl/$assetName" -OutFile $download -UseBasicParsing
        }
        catch {
            Write-Err "Download failed. Check that release $Version exists with asset $assetName."
        }

        # Check it against the checksums published with the release
        $sumsPath = Join-Path $tempDir "SHA256SUMS"
        try {
            Invoke-WebRequest -Uri "$releaseUrl/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing
        }
        catch {
            Write-Err "Release $Version has no SHA256SUMS, so the download cannot be checked."
        }

        $expected = $null
        foreach ($line in Get-Content $sumsPath) {
            $parts = $line -split "\s+", 2
            if ($parts.Count -eq 2 -and $parts[1].TrimStart("*") -eq $assetName) { $expected = $parts[0] }
        }
        if (-not $expected) {
            Write-Err "SHA256SUMS for $Version does not list $assetName."
        }

        $actual = (Get-FileHash -Algorithm SHA256 $download).Hash
        if ($actual -ne $expected) {
            Write-Err "Checksum mismatch for ${assetName}: expected $expected, got $actual. Nothing was installed."
        }
        Write-Info "Checksum verified"

        # Install
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }
        Move-Item $download (Join-Path $InstallDir $script:BinaryName) -Force
    }
    finally {
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Add-ToPath $InstallDir

    Write-Info "Installation complete!"
    Write-Info "Run 'forgitten --help' to get started"
    Write-Info ""
    Write-Info "Note: Restart your terminal for PATH changes to take effect"
}

if ($Uninstall) {
    Uninstall-Forgitten
}
else {
    Install-Forgitten
}
