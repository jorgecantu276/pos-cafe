import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

test('real message pipe preserves binary bytes and drains TCP response after Docker-style CloseWrite',
  { skip: process.platform !== 'win32', timeout: 25_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pos-pipe-regression-'));
    try {
      const harness = path.join(directory, 'Harness.cs');
      const executable = path.join(directory, 'Harness.exe');
      // Exercise the actual relay method, with a unique test pipe and an OS
      // assigned TCP port. Main's hosted-only docker_engine listener never runs.
      await writeFile(harness, String.raw`
using System;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

internal static class Harness {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool WriteFile(SafePipeHandle handle, byte[] data, uint length, out uint written, IntPtr overlapped);
  static byte[] Bytes(int length, int seed) {
    var result = new byte[length]; new Random(seed).NextBytes(result); return result;
  }
  static void Same(byte[] expected, byte[] actual) {
    if (expected.Length != actual.Length) throw new Exception("Binary length differs");
    for (int i = 0; i < expected.Length; i++) if (expected[i] != actual[i]) throw new Exception("Binary content differs");
  }
  static async Task Exercise(bool halfClose) {
    string name = "pos-relay-test-" + Guid.NewGuid().ToString("N");
    var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    int port = ((IPEndPoint)listener.LocalEndpoint).Port;
    byte[] request = Bytes(131071, 1), response = Bytes(524287, 2);
    var pipe = WslDockerPipe.CreatePipe(name);
    try {
      var server = Task.Run(async () => {
        using (var socket = await listener.AcceptTcpClientAsync())
        using (var stream = socket.GetStream()) {
          using (var received = new MemoryStream()) {
            if (halfClose) {
              await stream.CopyToAsync(received); 
            } else {
              byte[] buffer = new byte[8192];
              while (received.Length < request.Length) {
                int count = await stream.ReadAsync(buffer, 0, Math.Min(buffer.Length, request.Length - (int)received.Length));
                if (count == 0) throw new Exception("Early client EOF");
                received.Write(buffer, 0, count);
              }
            }
            Same(request, received.ToArray());
          }
          // The response starts after request EOF and exceeds every pipe/socket
          // buffer, so closing both directions on EOF cannot pass this test.
          await Task.Delay(50);
          await stream.WriteAsync(response, 0, response.Length);
          socket.Client.Shutdown(SocketShutdown.Send);
        }
      });
      var relay = Task.Run(async () => { await pipe.WaitForConnectionAsync(); await WslDockerPipe.Relay(pipe, port); });
      using (var client = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.None)) {
        client.Connect(5000);
        client.Write(request, 0, request.Length);
        if (halfClose) {
          client.Flush(); 
          uint written;
          // Stream.Write(empty) skips the OS call. go-winio CloseWrite uses an
          // actual zero-byte WriteFile message, which must reach the relay.
          if (!WriteFile(client.SafePipeHandle, new byte[0], 0, out written, IntPtr.Zero))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        using (var received = new MemoryStream()) { client.CopyTo(received); Same(response, received.ToArray()); }
      }
      await server; await relay;
    } finally { pipe.Dispose(); listener.Stop(); }
  }
  public static int Main() {
    try {
      for (int iteration = 0; iteration < 10; iteration++) {
        Exercise(true).GetAwaiter().GetResult();
        Exercise(false).GetAwaiter().GetResult();
      }
      Console.WriteLine("binary-and-half-close-ok"); return 0;
    } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
  }
}
`);
      const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
      await run(compiler, ['/nologo', '/target:exe', '/main:Harness', `/out:${executable}`,
        path.resolve('scripts/testing/WslDockerPipe.cs'), harness], { timeout: 10_000 });
      const result = await run(executable, [], { timeout: 10_000 });
      assert.equal(result.stdout.trim(), 'binary-and-half-close-ok');
      assert.equal(result.stderr, '');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

test('hosted Native runner keeps stdout separate and bounds only its owned child',
  { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pos-native-regression-'));
    try {
      const script = path.join(directory, 'Native.test.ps1');
      await writeFile(script, String.raw`
#Requires -Version 7.2
param([string]$Bootstrap,[string]$Node,[string]$WorkDirectory)
$ErrorActionPreference='Stop'
$tokens=$null; $parseErrors=$null
$syntax=[Management.Automation.Language.Parser]::ParseFile($Bootstrap,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors|Out-String)}
$functionNode=$syntax.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Native'},$true)
if(!$functionNode){throw 'Native function was not found'}
# Only this function is evaluated: no bootstrap, host Docker, service or WSL code.
Invoke-Expression $functionNode.Extent.Text
$canaryFunction=$syntax.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Canary-Hash'},$true)
if(!$canaryFunction){throw 'Canary-Hash function was not found'}
Invoke-Expression $canaryFunction.Extent.Text
$measurementFunction=$syntax.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Canary-Measurement'},$true)
if(!$measurementFunction){throw 'Canary-Measurement function was not found'}
Invoke-Expression $measurementFunction.Extent.Text
$empty=Canary-Measurement $null ('a'*64)
if($empty.characters -ne 0 -or $empty.exactCanaryBytes -or $empty.sha256 -cne 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'){throw 'empty stream measurement changed'}
$privateFixture='synthetic-private-diagnostic-value'
if((Canary-Measurement $privateFixture ('a'*64)|ConvertTo-Json -Compress).Contains($privateFixture)){throw 'stream measurement leaked raw diagnostic bytes'}
$privateIpFunction=$syntax.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Private-IPv4'},$true)
if(!$privateIpFunction){throw 'Private-IPv4 function was not found'}
Invoke-Expression $privateIpFunction.Extent.Text
if((Private-IPv4 '172.24.1.2') -cne '172.24.1.2'){throw 'actual private IPv4 changed'}
foreach($address in @('127.0.0.1','1.1.1.1','172.32.0.1','hostname','10.1','010.1.2.3','10.0.0.256','::1')){
  $refused=$false;try{Private-IPv4 $address}catch{$refused=$true};if(!$refused){throw 'noncanonical/public network address accepted'}
}
$digest='a'*64
if((Canary-Hash ($digest+"  /fixture/canary.txt"+[Environment]::NewLine) $digest 'Synthetic bind') -cne $digest){throw 'canary SHA parser changed the measured digest'}
$mismatch=$false
try{Canary-Hash (('b'*64)+'  /fixture/canary.txt') $digest 'Synthetic bind'}catch{$mismatch=$_.Exception.Message.Contains('observed SHA-256 '+('b'*64))}
if(!$mismatch){throw 'canary SHA mismatch did not retain safe measurements'}
$invalid=$false
try{Canary-Hash ('unexpected'+[Environment]::NewLine+$digest+'  /fixture/canary.txt') $digest 'Synthetic bind'}catch{$invalid=$_.Exception.Message.Contains('invalid SHA-256 output')}
if(!$invalid){throw 'canary SHA parser accepted extra command output'}
$actual=Native -Executable $Node -Arguments @('-e','process.stderr.write("pull progress");process.stdout.write(process.argv[1])','container id with spaces')
if($actual -cne 'container id with spaces'){throw 'stdout or argument corruption'}
if((Get-Content (Join-Path $WorkDirectory 'native-stderr.log') -Raw).Trim() -cne 'pull progress'){throw 'stderr lost'}
$eof=Native -Executable $Node -Arguments @('-e','process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("valid-eof"))') -CloseInput -TimeoutSeconds 3
if($eof -cne 'valid-eof'){throw 'explicit redirected stdin did not deliver valid EOF'}
$originalApi=$env:DOCKER_API_VERSION
$childApi=Native -Executable $Node -Arguments @('-e','process.stdout.write(process.env.DOCKER_API_VERSION)') -ApiVersion '1.44'
if($childApi -cne '1.44' -or $env:DOCKER_API_VERSION -cne $originalApi){throw 'API version must affect only the explicit child process'}
$failed=$false
try{Native -Executable $Node -Arguments @('-e','process.stderr.write("synthetic command failed");process.exit(7)')}catch{$failed=$_.Exception.Message.Contains('synthetic command failed')}
if(!$failed){throw 'nonzero exit not reported'}
$bounded=$false; $timer=[Diagnostics.Stopwatch]::StartNew()
try{Native -Executable $Node -Arguments @('-e','setInterval(()=>{},1000)') -TimeoutSeconds 1}catch{$bounded=$_.Exception.Message.Contains('deadline')}
if(!$bounded -or $timer.Elapsed.TotalSeconds -gt 5){throw 'owned child deadline failed'}
'native-regression-ok'
`);
      const result = await run('pwsh.exe', ['-NoProfile', '-File', script, '-Bootstrap',
        path.resolve('scripts/testing/Start-HostedWslDocker.ps1'), '-Node', process.execPath,
        '-WorkDirectory', directory], { timeout: 12_000 });
      assert.match(result.stdout, /native-regression-ok/);
      assert.equal(result.stderr, '');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
