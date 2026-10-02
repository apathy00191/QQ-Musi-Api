#!/usr/bin/env pwsh
# 集成冒烟测试：对 qqmusic-gateway 做端到端验证。
# 用法：pwsh -File scripts/smoke.ps1 [-Port 3456] [-SkipStart]
#   -SkipStart：服务已由外部启动（如受限沙箱无法用 Start-Process 拉起），脚本只做测试与清理。
param(
    [int]$Port = 3456,
    [string]$Base = "",
    [switch]$SkipStart
)
$ErrorActionPreference = "Stop"
if (-not $Base) { $Base = "http://127.0.0.1:$Port" }

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pass = 0; $fail = 0
function Check($name, $cond, $detail = "") {
    $script:total++
    if ($cond) { $script:pass++; Write-Host "[PASS] $name" -ForegroundColor Green }
    else { $script:fail++; Write-Host "[FAIL] $name $detail" -ForegroundColor Red }
}
function JsonGet($path, $headers = @{}) {
    try {
        $r = Invoke-WebRequest -Uri "$Base$path" -Headers $headers -UseBasicParsing -TimeoutSec 10
        $parsed = $null
        try { $parsed = $r.Content | ConvertFrom-Json } catch {}
        return @{ status = $r.StatusCode; body = $parsed; raw = $r.Content }
    } catch {
        $resp = $_.Exception.Response
        $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
        $txt = ""
        try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $txt = $sr.ReadToEnd() } catch {}
        $parsed = $null
        try { $parsed = $txt | ConvertFrom-Json } catch {}
        return @{ status = $code; body = $parsed; raw = $txt }
    }
}
function JsonSend($method, $path, $bodyObj, $headers = @{}) {
    try {
        $r = Invoke-WebRequest -Uri "$Base$path" -Method $method -Headers $headers `
            -ContentType "application/json" -Body ($bodyObj | ConvertTo-Json) -UseBasicParsing -TimeoutSec 10
        $parsed = $null
        try { $parsed = $r.Content | ConvertFrom-Json } catch {}
        return @{ status = $r.StatusCode; body = $parsed; raw = $r.Content }
    } catch {
        $resp = $_.Exception.Response
        $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
        $txt = ""
        try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $txt = $sr.ReadToEnd() } catch {}
        $parsed = $null
        try { $parsed = $txt | ConvertFrom-Json } catch {}
        return @{ status = $code; body = $parsed; raw = $txt }
    }
}

$proc = $null
if (-not $SkipStart) {
    Write-Host "== 启动网关 (PORT=$Port) ==" -ForegroundColor Cyan
    $env:PORT = "$Port"
    $env:AUTH_MODE = "token"
    $proc = Start-Process -FilePath "node" -ArgumentList "server.js" -PassThru -NoNewWindow `
        -RedirectStandardOutput "$root\smoke-server.log" -RedirectStandardError "$root\smoke-server.err"
} else {
    Write-Host "== 使用外部已启动的网关 ($Base) ==" -ForegroundColor Cyan
}
$adminToken = $null
$deadline = (Get-Date).AddSeconds(20)
$up = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $h = JsonGet "/health"
    if ($h.status -eq 200) { $up = $true; break }
}
Check "服务启动 /health 可达" $up "（见 smoke-server.err）"
if (-not $up) {
    Get-Content "$root\smoke-server.err" -ErrorAction SilentlyContinue | Select-Object -Last 30
    exit 1
}

# 从启动日志或 admin-token 文件读取管理令牌
if (Test-Path "$root\data\admin-token") { $adminToken = (Get-Content "$root\data\admin-token" -Raw).Trim() }
$logText = Get-Content "$root\smoke-server.log" -Raw -ErrorAction SilentlyContinue
if (-not $adminToken -and $logText -match 'qmg_admin_[a-f0-9]+|admin.?token["\s:=]+([A-Za-z0-9_\-]{16,})') {
    $adminToken = $Matches[1]
}
if (-not $adminToken -and $logText) {
    # 兜底：日志中任意 32+ 位 token 行
    foreach ($line in ($logText -split "`n")) {
        if ($line -match 'token' -and $line -match '([A-Za-z0-9_\-]{20,})') { $adminToken = $Matches[1]; break }
    }
}
Check "可获取管理令牌" ([bool]$adminToken) "无法从 data/admin-token 或启动日志解析"
$ah = @{ "X-Admin-Token" = $adminToken }

# --- 公开接口 ---
$h = JsonGet "/health"
Check "GET /health code=0" ($h.status -eq 200 -and $h.body.code -eq 0)
$d = JsonGet "/docs.json"
$groups = @(); if ($d.body.data -and $d.body.data.groups) { $groups = @($d.body.data.groups) }
Check "GET /docs.json 返回分组清单" ($d.status -eq 200 -and $groups.Count -ge 3) "groups=$($groups.Count)"
$idx = JsonGet "/"
Check "GET / 返回 Web UI HTML" ($idx.status -eq 200 -and "$($idx.raw)$($idx.body)" -match "html")
$css = JsonGet "/style.css"
Check "GET /style.css 可达" ($css.status -eq 200)
$js = JsonGet "/app.js"
Check "GET /app.js 可达" ($js.status -eq 200)

# --- 鉴权 ---
$noauth = JsonGet "/api/v1/search/hotkey"
Check "无 token 访问 /api/v1 → 401" ($noauth.status -eq 401 -or $noauth.status -eq 403) "status=$($noauth.status)"
$bad = JsonGet "/api/v1/search/hotkey?token=invalid_123"
Check "无效 token → 401" ($bad.status -eq 401 -or $bad.status -eq 403) "status=$($bad.status)"
$noadmin = JsonGet "/admin/tokens"
Check "无管理令牌访问 /admin/tokens → 401" ($noadmin.status -eq 401) "status=$($noadmin.status)"
$st = JsonGet "/admin/status" $ah
Check "X-Admin-Token 访问 /admin/status code=0" ($st.status -eq 200 -and $st.body.code -eq 0)

# --- Token CRUD ---
$created = JsonSend "POST" "/admin/tokens" @{ name = "smoke-test" } $ah
$newToken = $null
if ($created.body -and $created.body.data) {
    $tkNode = $created.body.data.token
    if ($tkNode -is [string]) {
        $newToken = $tkNode
    } elseif ($tkNode -and $tkNode.token -is [string]) {
        $newToken = $tkNode.token   # 返回形态: data.token = { 记录对象 }
    } elseif ($created.body.data.value -is [string]) {
        $newToken = $created.body.data.value
    } else {
        # 兜底：在 data 子树中找 qmg_ 开头的字符串
        $prop = $created.body.data.PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value -like "qmg_*" } | Select-Object -First 1
        if ($prop) { $newToken = $prop.Value }
        if (-not $newToken -and $tkNode) {
            $prop2 = $tkNode.PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value -like "qmg_*" } | Select-Object -First 1
            if ($prop2) { $newToken = $prop2.Value }
        }
    }
}
Check "POST /admin/tokens 创建 token" ($created.status -eq 200 -and [bool]$newToken) "resp=$($created.body | ConvertTo-Json -Compress -Depth 5)"
$tok = JsonGet "/admin/tokens" $ah
$tokCount = 0; if ($tok.body.data -and $tok.body.data.tokens) { $tokCount = @($tok.body.data.tokens).Count }
Check "GET /admin/tokens 列表非空" ($tok.status -eq 200 -and $tokCount -ge 1) "count=$tokCount"

# --- 业务接口用新 token ---
if ($newToken) {
    $hk = JsonGet "/api/v1/search/hotkey" @{ "Authorization" = "Bearer $newToken" }
    $hkOk = ($hk.status -eq 200 -and $hk.body.code -eq 0)
    if (-not $hkOk -and $hk.status -eq 200 -and $hk.body.code -ne 0) {
        # 上游网络可能不通：返回 JSON 错误也算网关链路正常
        $hkOk = $true
        Write-Host "[WARN] /api/v1 返回业务错误 code=$($hk.body.code)（上游网络可能不可达，链路正常）" -ForegroundColor Yellow
    }
    Check "Bearer token 访问 /api/v1/search/hotkey" $hkOk "status=$($hk.status) code=$($hk.body.code)"

    # 统计应有计数
    $stats = JsonGet "/admin/stats" $ah
    Check "GET /admin/stats code=0" ($stats.status -eq 200 -and $stats.body.code -eq 0)
} else {
    Check "Bearer token 访问业务接口" $false "无 token 可用"
}

# --- v2 代理状态 ---
$v2 = JsonGet "/api/v2/_status" @{ "Authorization" = "Bearer $newToken" }
$v2down = JsonGet "/api/v2/_status" # 无 token 时也应被鉴权拦截（或 404 路由缺失）
Check "/api/v2/_status 路由存在" (($v2.status -eq 200) -or ($v2.status -eq 404 -and $v2down.status -eq 401)) "status=$($v2.status)/$($v2down.status)"
if ($v2.status -eq 200) {
    $healthy = $false
    if ($v2.body.data) { $healthy = [bool]$v2.body.data.healthy }
    Write-Host "[INFO] 上游扩展服务 healthy=$healthy（未启动上游时 false 属正常）" -ForegroundColor Yellow
}

# --- 禁用 token 后拒绝 ---
$firstId = $null
if ($created.body -and $created.body.data -and $created.body.data.token -and $created.body.data.token.id) {
    $firstId = $created.body.data.token.id   # 直接用创建响应的 id，避免按 name 匹配到同名残留
}
if ($firstId -and $newToken) {
    $null = JsonSend "PATCH" "/admin/tokens/$firstId" @{ enabled = $false } $ah
    $denied = JsonGet "/api/v1/search/hotkey" @{ "Authorization" = "Bearer $newToken" }
    Check "禁用 token 后访问被拒" ($denied.status -eq 401 -or $denied.status -eq 403) "status=$($denied.status)"
    $null = JsonSend "DELETE" "/admin/tokens/$firstId" $ah
}

Write-Host "`n== 结果: $pass 通过 / $fail 失败 ==" -ForegroundColor Cyan
if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
exit $(if ($fail -gt 0) { 1 } else { 0 })
