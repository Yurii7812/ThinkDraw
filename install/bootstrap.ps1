# BRESUTO を 1 行で入れる・最新にする(Windows 10 / 11)。PowerShell に貼る:
#   irm https://raw.githubusercontent.com/Yurii7812/bresuto/main/install/bootstrap.ps1 | iex
# Releases のいちばん新しい完成品(BRESUTO-Setup-版.exe)を落として、そのまま入れる(確認の画面は出さない)。
# この形で落とした物には「インターネットから来た」印が付かないので、「PC が保護されました」も出ない。入れたあとは自動で更新する
$ErrorActionPreference = 'Stop'
$repo = if ($env:BRESUTO_GH) { $env:BRESUTO_GH } else { 'Yurii7812/bresuto' }
# いちばん新しい版の番号は、Releases の latest の転送先から読む(GitHub の API は問い合わせが多いと断られるので使わない)
$r = Invoke-WebRequest -Uri "https://github.com/$repo/releases/latest" -UseBasicParsing -Method Head
$final = if ($r.BaseResponse.RequestMessage) { $r.BaseResponse.RequestMessage.RequestUri.AbsoluteUri } else { $r.BaseResponse.ResponseUri.AbsoluteUri }
$tag = ($final -split '/tag/')[-1]
if ($tag -notmatch '^v\d') { throw 'いちばん新しい版が分かりません' }
$name = "BRESUTO-Setup-$($tag.Substring(1)).exe"
$asset = @{ name = $name; browser_download_url = "https://github.com/$repo/releases/download/$tag/$name" }
$rel = @{ tag_name = $tag }
$exe = Join-Path $env:TEMP $asset.name
Write-Host "取得しています: $($asset.name)"
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $exe -UseBasicParsing
if (Get-Process -Name 'BRESUTO' -ErrorAction SilentlyContinue) { throw 'BRESUTO が動いています。閉じてから、もう一度実行してください' }
Write-Host '入れています…'
Start-Process -FilePath $exe -ArgumentList '/S' -Wait
Remove-Item $exe -ErrorAction SilentlyContinue
Write-Host "入れました: BRESUTO $($rel.tag_name)(スタートメニューとデスクトップの BRESUTO から開けます)。新しい版は自動で入れ替わります"
