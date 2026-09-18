# Adds a favicon <link> tag to every .html file in the project that doesn't
# already have one. Run this from the project root (same place you run git).

$faviconTag = '<link rel="icon" type="image/png" href="/assets/images/jwings-logo.png" />'
$files = Get-ChildItem -Recurse -Filter "*.html" -ErrorAction SilentlyContinue

$updated = 0
foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw

    if ($content -match 'rel="icon"') {
        Write-Host "Skipping (already has favicon): $($file.FullName)"
        continue
    }

    if ($content -match '<head>') {
        $newContent = $content -replace '<head>', "<head>`n$faviconTag"
        Set-Content -Path $file.FullName -Value $newContent -NoNewline
        Write-Host "Added favicon: $($file.FullName)"
        $updated++
    } else {
        Write-Host "Skipping (no <head> tag found): $($file.FullName)"
    }
}

Write-Host ""
Write-Host "Done. Updated $updated file(s)."
