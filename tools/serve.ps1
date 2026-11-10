# 경북의대 라운지 로컬 서버: 저장소 맨 위에서  powershell -ExecutionPolicy Bypass -File tools/serve.ps1
# 주소 http://localhost:8767/  (다른 번호: $env:PORT=8770 먼저). 캐시를 안 써서 고친 파일이 바로 보여요
$port = if ($env:PORT) { [int]$env:PORT } else { 8767 }
$root = Split-Path -Parent $PSScriptRoot
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json; charset=utf-8'; '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.ico'='image/x-icon'; '.md'='text/plain; charset=utf-8' }
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "http://localhost:$port/  (Ctrl+C로 멈춤)"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    $file = Join-Path $root $path
    if (Test-Path $file -PathType Container) { $file = Join-Path $file 'index.html' }
    $res = $ctx.Response
    $res.Headers.Add('Cache-Control', 'no-store')
    if ((Test-Path $file -PathType Leaf) -and ([IO.Path]::GetFullPath($file)).StartsWith([IO.Path]::GetFullPath($root))) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($file)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
    $res.Close()
  }
} finally { $listener.Stop() }
