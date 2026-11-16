# h05-external-scan.ps1 - closed-port scan of the public IPv4 and IPv6 addresses from OUTSIDE (N01-N08, DS04/DS05).
#
# Run from any machine that is NOT connected through WireGuard and has both IPv4 and IPv6 Internet:
#   pwsh -File h05-external-scan.ps1
# Expected: 80/443 open on the shared IPv4 only (edge); everything else closed/filtered on both
# families; the guests' routed IPv6 /128 addresses expose nothing. Nothing here sends payload data:
# it only attempts a TCP handshake (connect scan) and an ICMP echo.
param(
  [string]$PublicV4 = "65.108.38.218",
  [string[]]$PublicV6 = @("2a01:4f9:3080:344e::2", "2a01:4f9:3080:344e::100", "2a01:4f9:3080:344e::200"),
  [int]$TimeoutMs = 2500
)

$ports = 22, 25, 53, 80, 111, 443, 3128, 4300, 4301, 5355, 5432, 6379, 8006, 8080, 8200, 8201, 30000
# Ports that MUST be open on the shared IPv4 (edge) and nowhere else.
$expectedOpen = @{ "$PublicV4" = @(80, 443) }

function Test-TcpPort([string]$Address, [int]$Port, [int]$Timeout) {
  $family = if ($Address.Contains(":")) { [System.Net.Sockets.AddressFamily]::InterNetworkV6 } else { [System.Net.Sockets.AddressFamily]::InterNetwork }
  $client = [System.Net.Sockets.TcpClient]::new($family)
  try {
    $task = $client.ConnectAsync($Address, $Port)
    if ($task.Wait($Timeout) -and $client.Connected) { return "open" }
    return "closed_or_filtered"
  } catch { return "closed_or_filtered" } finally { $client.Dispose() }
}

$failures = 0
foreach ($target in @($PublicV4) + $PublicV6) {
  $ping = Test-Connection -TargetName $target -Count 2 -TimeoutSeconds 2 -Quiet -ErrorAction SilentlyContinue
  Write-Output "TARGET $target icmp_echo=$ping"
  foreach ($port in $ports) {
    $state = Test-TcpPort $target $port $TimeoutMs
    $want = if ($expectedOpen.ContainsKey($target) -and $expectedOpen[$target] -contains $port) { "open" } else { "closed_or_filtered" }
    $verdict = if ($state -eq $want) { "PASS" } else { "FAIL"; $failures++ }
    Write-Output ("  tcp/{0,-5} {1,-18} expected={2,-18} {3}" -f $port, $state, $want, $verdict)
  }
}
Write-Output "SCAN_FAILURES=$failures"
exit $failures
