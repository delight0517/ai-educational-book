$ErrorActionPreference = 'Stop'
$appName = 'AI Educational Book'
$processName = 'AiEducationalBook'
$installRoot = Join-Path $env:LOCALAPPDATA $appName
$sourceExe = Join-Path $PSScriptRoot 'publish\win-x64\AiEducationalBook.exe'
$expectedSha256 = 'C65C40151944AF68DFC53A3AC83B5B1F2275DEE7BD349E0BEFCEA957559ADE4C'

if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) { throw "Candidate executable not found: $sourceExe" }
$actual = (Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256).Hash
if ($actual -ne $expectedSha256) { throw 'Candidate hash does not match this installer. Rebuild and review the candidate before updating the pinned hash.' }
if (Get-Process -Name $processName -ErrorAction SilentlyContinue) { throw 'AI Educational Book is running. Close it, then run the installer again.' }

$rollbackRoot = Join-Path $installRoot 'rollback'
if (Test-Path -LiteralPath $installRoot) {
    $allowed = @('AiEducationalBook.exe', 'install-receipt.txt', 'rollback')
    $unexpected = Get-ChildItem -LiteralPath $installRoot -Force | Where-Object { $_.Name -notin $allowed }
    if ($unexpected) { throw "Install folder contains unrecognized files; left untouched: $($unexpected.Name -join ', ')" }
    if (Test-Path -LiteralPath $rollbackRoot) {
        $unexpectedRollback = Get-ChildItem -LiteralPath $rollbackRoot -Force | Where-Object { $_.PSIsContainer -or $_.Extension -notin @('.exe', '.sha256') }
        if ($unexpectedRollback) { throw 'Rollback folder contains unrecognized files; left untouched.' }
        $rollbackExecutables = Get-ChildItem -LiteralPath $rollbackRoot -Filter '*.exe' -File
        foreach ($rollbackExe in $rollbackExecutables) {
            $hashFile = "$($rollbackExe.FullName).sha256"
            if (-not (Test-Path -LiteralPath $hashFile)) { throw "Rollback hash receipt is missing; preserved without changes: $($rollbackExe.Name)" }
            $pinnedRollback = (Get-Content -LiteralPath $hashFile -Raw).Trim()
            if ((Get-FileHash -LiteralPath $rollbackExe.FullName -Algorithm SHA256).Hash -ne $pinnedRollback) { throw "Rollback hash mismatch; preserved without changes: $($rollbackExe.Name)" }
        }
        foreach ($hashFile in Get-ChildItem -LiteralPath $rollbackRoot -Filter '*.sha256' -File) {
            if (-not (Test-Path -LiteralPath ($hashFile.FullName.Substring(0, $hashFile.FullName.Length - 7)))) { throw "Orphan rollback hash receipt; preserved without changes: $($hashFile.Name)" }
        }
    }
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
$stage = Join-Path $installRoot ('.stage-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$liveExe = Join-Path $installRoot 'AiEducationalBook.exe'
$backup = $null
try {
    Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $stage 'AiEducationalBook.exe')
    if ((Get-FileHash -LiteralPath (Join-Path $stage 'AiEducationalBook.exe') -Algorithm SHA256).Hash -ne $expectedSha256) { throw 'Staged executable hash mismatch.' }
    if (Test-Path -LiteralPath $liveExe) {
        $installedHash = (Get-FileHash -LiteralPath $liveExe -Algorithm SHA256).Hash
        $receiptPath = Join-Path $installRoot 'install-receipt.txt'
        if (-not (Test-Path -LiteralPath $receiptPath) -or -not (Select-String -LiteralPath $receiptPath -SimpleMatch "SHA-256: $installedHash" -Quiet)) { throw 'Installed executable does not match its receipt; left untouched.' }
        New-Item -ItemType Directory -Force -Path $rollbackRoot | Out-Null
        $backup = Join-Path $rollbackRoot ('AiEducationalBook-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.exe')
        Move-Item -LiteralPath $liveExe -Destination $backup
        Set-Content -LiteralPath "$backup.sha256" -Encoding ascii -Value $installedHash
    }
    Move-Item -LiteralPath (Join-Path $stage 'AiEducationalBook.exe') -Destination $liveExe
    if ((Get-FileHash -LiteralPath $liveExe -Algorithm SHA256).Hash -ne $expectedSha256) { throw 'Installed executable hash mismatch.' }
    Set-Content -LiteralPath (Join-Path $installRoot 'install-receipt.txt') -Encoding utf8 -Value @(
        "App: $appName", "Installed: $(Get-Date -Format o)", "Source: $sourceExe", "SHA-256: $expectedSha256", 'Signature: self-signed; publisher is not trusted by default'
    )
    if (Test-Path -LiteralPath $rollbackRoot) {
        $expiredBackups = Get-ChildItem -LiteralPath $rollbackRoot -Filter '*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2
        foreach ($expired in $expiredBackups) { Remove-Item -LiteralPath $expired.FullName -Force; Remove-Item -LiteralPath "$($expired.FullName).sha256" -Force -ErrorAction SilentlyContinue }
    }
    Write-Host "Installed to $liveExe"
    Write-Host 'Receipt: install-receipt.txt'
    Write-Host 'To roll back manually, close the app and replace AiEducationalBook.exe with one of the verified executables in rollback.'
}
catch {
    if (Test-Path -LiteralPath $liveExe) { Remove-Item -LiteralPath $liveExe -Force }
    if ($backup -and (Test-Path -LiteralPath $backup)) { Move-Item -LiteralPath $backup -Destination $liveExe; Remove-Item -LiteralPath "$backup.sha256" -Force -ErrorAction SilentlyContinue }
    throw
}
finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}





# SIG # Begin signature block
# MIIF1AYJKoZIhvcNAQcCoIIFxTCCBcECAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCCagkrDVw/UzyXj
# qaNwi29jNDH32F+r1/FD1DByUS+q66CCAzQwggMwMIICGKADAgECAhAnnXrTyeDz
# v0pqw27MqPnDMA0GCSqGSIb3DQEBCwUAMDAxLjAsBgNVBAMMJUFJIEVkdWNhdGlv
# bmFsIEJvb2sgTG9jYWwgU2VsZi1TaWduZWQwHhcNMjYxMTEwMTEyNDAwWhcNMjgx
# MTEwMTEzNDAxWjAwMS4wLAYDVQQDDCVBSSBFZHVjYXRpb25hbCBCb29rIExvY2Fs
# IFNlbGYtU2lnbmVkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyKjQ
# VQe28GtCL8Z6NCV/3Hsso09FnMv6IDIXSR8PqEzVtdjvgNdfdzuLL4NRUzKkvl2v
# Yfu7LHiL4HzkIwTueC66pHiW2tjbeslTwbBXvEoT5dNJZd7JfZvkbbTscTbLOUJz
# G1JAZh2NwD1Ity8c9cvLULDZqvbOcStY9ME2XHB1wDfM8Qe6znDR9jP2GhuaRPrp
# 0/Wq1K6CEsvLO1y2yZa9mZcdqbef7Z6k3rQbjQjBIdtsXmPGH15UD3PT4yShr+aF
# sYKOuX57vcyV8dpneHAGr2AmziE4ccVjt78lszeEqBXMdN6ilrZ5ptSqvdLLaZct
# am36NAxfpuZQXun37QIDAQABo0YwRDAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAww
# CgYIKwYBBQUHAwMwHQYDVR0OBBYEFAQLT8E2nkGarMAPBt0zB7oQk+b8MA0GCSqG
# SIb3DQEBCwUAA4IBAQC4vDjmCE7/xpX/ayXALZ0F/4iG5HDhf/7ZhLs+7EpBU2/M
# ckFK2lhMpEWfBkNgn4TTIIOL3SVvJTpkpl+UgvPoEoi0bfoc7SuwYDtOrw6f2/Hs
# QgC1W/AHe1ZRXO9TR4lnNbiZk9sk50eP6NrTUze0YeBY2IeG8XmwPmXWtNQbIEn0
# qP9gytJ3upNIFTnxC66OEVzFE+PtZDZrvZQSmKllzfse4K/WnZ9iHrv0crEAA2zQ
# Yrsd7bYMFen5MMMKF675unuvExJIqC/LL2O/i8DYTwjVlTXinlepripm582Olonk
# NlSgpUIPn3FCDUd9q75lP1oEpMzByt5HVvFcpYXXMYIB9jCCAfICAQEwRDAwMS4w
# LAYDVQQDDCVBSSBFZHVjYXRpb25hbCBCb29rIExvY2FsIFNlbGYtU2lnbmVkAhAn
# nXrTyeDzv0pqw27MqPnDMA0GCWCGSAFlAwQCAQUAoIGEMBgGCisGAQQBgjcCAQwx
# CjAIoAKAAKECgAAwGQYJKoZIhvcNAQkDMQwGCisGAQQBgjcCAQQwHAYKKwYBBAGC
# NwIBCzEOMAwGCisGAQQBgjcCARUwLwYJKoZIhvcNAQkEMSIEIB5/ERCyb7GNDWjf
# uEiOE8iepykKZ4E7Cck3MKBSky5cMA0GCSqGSIb3DQEBAQUABIIBACfDJcin5BXW
# DUVfUFW1AOvNWiJNduk+m1U6ZR52V0lfILNKTRwvQ0XXoyHv9eQcYsf9gX4piR4R
# hfxwrVU1AmqTMAW2lSu0RGngNSYQcheEesQwxla9BCXPjRWSalOJRthy9cNvK9Mi
# 03Ic7ZtJAslmDV31l7qds8iW/zwwUEKogYzaahIHVZNwIouJbWd44+LqKRhFJsC6
# KvZzwURKfO4CT0Ofjim/6QvoCW/4UuI87zthR8bKWMMu51yU8C8N1gu5aNQ8OXdZ
# iyPnBnAAEsIhOEAN85m5Hs0c3ZMFklvm1Hcn7pJIscRJJGDRebeQ+7gQn8GY5tVk
# 94Q+A4XrLZM=
# SIG # End signature block
