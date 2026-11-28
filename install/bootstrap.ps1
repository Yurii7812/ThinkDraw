# BRESUTO を 1 行で入れる・最新にする(Windows 10 / 11)。PowerShell に貼る:
#   irm https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.ps1 | iex
# Releases のいちばん新しい完成品(BRESUTO-Setup-版.exe)を落として、そのまま入れる(確認の画面は出さない)。
# この形で落とした物には「インターネットから来た」印が付かないので、「PC が保護されました」も出ない。入れたあとは自動で更新する
$ErrorActionPreference = 'Stop'
$repo = if ($env:BRESUTO_GH) { $env:BRESUTO_GH } else { 'Yurii7812/bresuto' }
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'bresuto-installer' }
$asset = $rel.assets | Where-Object { $_.name -match '^BRESUTO-Setup-.*\.exe$' } | Select-Object -First 1
if (-not $asset) { throw 'Releases に Windows の完成品が見つかりません' }
$exe = Join-Path $env:TEMP $asset.name
Write-Host "取得しています: $($asset.name)"
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $exe -UseBasicParsing
if (Get-Process -Name 'BRESUTO' -ErrorAction SilentlyContinue) { throw 'BRESUTO が動いています。閉じてから、もう一度実行してください' }
Write-Host '入れています…'
Start-Process -FilePath $exe -ArgumentList '/S' -Wait
Remove-Item $exe -ErrorAction SilentlyContinue
Write-Host "入れました: BRESUTO $($rel.tag_name)(スタートメニューとデスクトップの BRESUTO から開けます)。新しい版は自動で入れ替わります"
