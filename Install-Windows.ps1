param(
    [string]$CandidateExe = '',
    [switch]$CloseRunning,
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
$appName = 'AI Educational Book'
$processName = 'AiEducationalBook'
$installRoot = Join-Path $env:LOCALAPPDATA $appName
$rollbackRoot = Join-Path $PSScriptRoot 'recovery\install-rollback'
$minEmbeddedBytes = 78643200L # 75 MiB minimum for Tauri custom-protocol embedded static frontend

if ([string]::IsNullOrWhiteSpace($CandidateExe)) {
    $CandidateExe = Join-Path $PSScriptRoot 'recovery\cargo-target\release\AiEducationalBook.exe'
}

if (-not (Test-Path -LiteralPath $CandidateExe -PathType Leaf)) {
    throw "Candidate executable not found: $CandidateExe`nBuild via: node scripts/tauri.mjs build --no-bundle --config '{""build"":{""beforeBuildCommand"":""""}}'"
}

$sourceInfo = Get-Item -LiteralPath $CandidateExe
if ($sourceInfo.Length -lt $minEmbeddedBytes) {
    throw ("ABORTED: Candidate binary is only {0:N2} MiB ({1} bytes), below the {2:N0} MiB minimum required for embedded Tauri static assets (tauri/custom-protocol). " +
           "Bare 'cargo build --release' omits frontend assets and causes AiEducationalBook.exe to hang headless waiting on http://localhost:3000. " +
           "Always build frontend with 'next build --webpack' and compile via 'node scripts/tauri.mjs build --no-bundle'.") -f ($sourceInfo.Length / 1MB), $sourceInfo.Length, ($minEmbeddedBytes / 1MB)
}

$expectedSha256 = (Get-FileHash -LiteralPath $CandidateExe -Algorithm SHA256).Hash

# Inspect existing AiEducationalBook processes BEFORE smoke test (single-instance mutex)
$existingProcs = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
foreach ($proc in $existingProcs) {
    if ($proc.MainWindowHandle -eq 0) {
        Write-Warning "Terminating headless zombie AiEducationalBook process PID=$($proc.Id) (MainWindowHandle=0)."
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
    } elseif ($CloseRunning) {
        Write-Host "Closing visible AiEducationalBook process PID=$($proc.Id) per -CloseRunning..."
        [void]$proc.CloseMainWindow()
        Start-Sleep -Milliseconds 800
        if (-not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300
        }
    } else {
        throw "AI Educational Book is running with a visible window (PID=$($proc.Id)). Close it or pass -CloseRunning, then run Install-Windows.ps1 again."
    }
}

# Gate 2: Isolated pre-promotion smoke launch check (verifies a real visible window opens)
$smokeStatus = 'SKIPPED'
if (-not $SkipSmokeTest) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AiebSmokeProbe {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    public static bool HasVisibleAppWindow(uint targetPid) {
        bool found = false;
        EnumWindows((hwnd, _) => {
            if (!IsWindowVisible(hwnd)) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid != targetPid) return true;
            RECT r;
            if (GetWindowRect(hwnd, out r)) {
                int w = r.Right - r.Left;
                int h = r.Bottom - r.Top;
                if (w >= 400 && h >= 300) {
                    found = true;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@ -ErrorAction SilentlyContinue | Out-Null

    $smokeDir = Join-Path $env:TEMP ('aieb-smoke-' + [Guid]::NewGuid().ToString('N'))
    $smokeWebViewDir = Join-Path $smokeDir 'webview'
    New-Item -ItemType Directory -Force -Path $smokeWebViewDir | Out-Null
    $smokeExe = Join-Path $smokeDir 'AiEducationalBook.exe'
    $smokeProc = $null
    try {
        Copy-Item -LiteralPath $CandidateExe -Destination $smokeExe -Force
        $thumbSrc = Join-Path $sourceInfo.DirectoryName 'readest_thumbnail.dll'
        if (-not (Test-Path -LiteralPath $thumbSrc)) {
            $thumbSrc = Join-Path $installRoot 'readest_thumbnail.dll'
        }
        if (Test-Path -LiteralPath $thumbSrc) {
            Copy-Item -LiteralPath $thumbSrc -Destination (Join-Path $smokeDir 'readest_thumbnail.dll') -Force
        }

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $smokeExe
        $psi.WorkingDirectory = $smokeDir
        $psi.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $smokeWebViewDir
        $psi.UseShellExecute = $false
        $smokeProc = [System.Diagnostics.Process]::Start($psi)
        if (-not $smokeProc) {
            throw 'Failed to start smoke test process.'
        }

        $windowVisible = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Milliseconds 500
            if ($smokeProc.HasExited) {
                throw "Candidate exited prematurely during smoke test with exit code $($smokeProc.ExitCode)."
            }
            if ([AiebSmokeProbe]::HasVisibleAppWindow([uint32]$smokeProc.Id)) {
                $windowVisible = $true
                break
            }
        }
        if (-not $windowVisible) {
            throw 'ABORTED: Candidate started headless and failed to display a visible window (>=400x300) within 15s. Live install left untouched.'
        }
        $smokeStatus = "PASSED (PID=$($smokeProc.Id) visible >=400x300)"
        Write-Host "Pre-promotion smoke check: $smokeStatus"
    } finally {
        if ($smokeProc -and -not $smokeProc.HasExited) {
            Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 400
        }
        if (Test-Path -LiteralPath $smokeDir) {
            Remove-Item -LiteralPath $smokeDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
New-Item -ItemType Directory -Force -Path $rollbackRoot | Out-Null
$stage = Join-Path $installRoot ('.stage-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$liveExe = Join-Path $installRoot 'AiEducationalBook.exe'
$backup = $null
try {
    Copy-Item -LiteralPath $CandidateExe -Destination (Join-Path $stage 'AiEducationalBook.exe')
    if ((Get-FileHash -LiteralPath (Join-Path $stage 'AiEducationalBook.exe') -Algorithm SHA256).Hash -ne $expectedSha256) {
        throw 'Staged executable hash mismatch.'
    }

    if (Test-Path -LiteralPath $liveExe) {
        $installedItem = Get-Item -LiteralPath $liveExe
        $installedHash = (Get-FileHash -LiteralPath $liveExe -Algorithm SHA256).Hash
        if ($installedItem.Length -ge $minEmbeddedBytes) {
            $backup = Join-Path $rollbackRoot ('AiEducationalBook-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.exe')
            Copy-Item -LiteralPath $liveExe -Destination $backup -Force
            Set-Content -LiteralPath "$backup.sha256" -Encoding ascii -Value $installedHash
        }
    }

    $thumbCand = Join-Path $sourceInfo.DirectoryName 'readest_thumbnail.dll'
    if (Test-Path -LiteralPath $thumbCand) {
        Copy-Item -LiteralPath $thumbCand -Destination (Join-Path $installRoot 'readest_thumbnail.dll') -Force
    }

    Move-Item -LiteralPath (Join-Path $stage 'AiEducationalBook.exe') -Destination $liveExe -Force
    if ((Get-FileHash -LiteralPath $liveExe -Algorithm SHA256).Hash -ne $expectedSha256) {
        throw 'Installed executable hash mismatch.'
    }

    Set-Content -LiteralPath (Join-Path $installRoot 'install-receipt.txt') -Encoding utf8 -Value @(
        "App: $appName",
        "Installed: $(Get-Date -Format o)",
        "Source: $CandidateExe",
        "SizeBytes: $($sourceInfo.Length)",
        "SHA-256: $expectedSha256",
        "SmokeTest: $smokeStatus",
        "RollbackDir: $rollbackRoot"
    )

    # Clean up all previous versions once the new version is verified and promoted
    if (Test-Path -LiteralPath $rollbackRoot) {
        $expiredBackups = Get-ChildItem -LiteralPath $rollbackRoot -Filter 'AiEducationalBook-*.exe' -File -ErrorAction SilentlyContinue
        foreach ($expired in $expiredBackups) {
            Remove-Item -LiteralPath $expired.FullName -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "$($expired.FullName).sha256" -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Installed to $liveExe ($($sourceInfo.Length) bytes)"
    Write-Host "SHA-256: $expectedSha256"
    Write-Host "SmokeTest: $smokeStatus"

    # Universal User Library Storage & Millie Shortcut Initialization
    try {
        $userDoc = [Environment]::GetFolderPath('MyDocuments')
        if (-not $userDoc) { $userDoc = Join-Path $env:USERPROFILE 'Documents' }
        $userLib = Join-Path $userDoc '서재'
        if (-not (Test-Path -LiteralPath $userLib)) {
            New-Item -ItemType Directory -Path $userLib -Force | Out-Null
            Write-Host "Library directory created: $userLib"
        } else {
            Write-Host "Library directory ready: $userLib"
        }

        $millieApp = Get-StartApps | Where-Object { $_.Name -like '*밀리*' -or $_.AppID -like '*millie*' } | Select-Object -First 1
        if ($millieApp) {
            $lnk = Join-Path $userLib '밀리의 서재.lnk'
            if (-not (Test-Path -LiteralPath $lnk)) {
                $csharp = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport]
[Guid("00021401-0000-0000-C000-000000000046")]
public class ShellLinkInstaller {}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid("000214F9-0000-0000-C000-000000000046")]
public interface IShellLinkWInstaller {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszFile, int cchMaxPath, out IntPtr pfd, int fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszName, int cchMaxName);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszDir, int cchMaxPath);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszArgs, int cchMaxPath);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pszIconPath, int cchIconPath, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
    void Resolve(IntPtr hwnd, int fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
}

public class ShortcutHelperInstaller {
    public static void Create(string lnkPath, string targetPath, string arguments, string description) {
        var link = (IShellLinkWInstaller)new ShellLinkInstaller();
        link.SetPath(targetPath);
        if (!string.IsNullOrEmpty(arguments)) link.SetArguments(arguments);
        if (!string.IsNullOrEmpty(description)) link.SetDescription(description);
        var file = (IPersistFile)link;
        file.Save(lnkPath, true);
    }
}
'@
                Add-Type -TypeDefinition $csharp -ErrorAction SilentlyContinue
                $target = 'explorer.exe'
                $arguments = 'shell:AppsFolder\' + $millieApp.AppID
                [ShortcutHelperInstaller]::Create($lnk, $target, $arguments, '밀리의 서재 바로가기')
                Write-Host "Created Millie shortcut: $lnk"
            }
        }
    } catch {
        Write-Warning "Library storage initialization warning: $_"
    }
}
catch {
    if ($backup -and (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $backup -Destination $liveExe -Force -ErrorAction SilentlyContinue
        Write-Warning "Rolled back live executable from $backup"
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
