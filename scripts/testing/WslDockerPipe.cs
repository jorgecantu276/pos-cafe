// CI transport only. This is a byte-transparent named-pipe/TCP relay: it never
// parses Docker HTTP, synthesizes responses, rewrites binds or handles POS data.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Threading.Tasks;

internal static class WslDockerPipe {
  internal static async Task Relay(NamedPipeServerStream pipe, int port) {
    using (pipe)
    using (var client = new TcpClient()) {
      try {
        client.NoDelay = true;
        await client.ConnectAsync("127.0.0.1", port);
        using (var network = client.GetStream()) {
          var outbound = pipe.CopyToAsync(network);
          var inbound = network.CopyToAsync(pipe);
          var completed = await Task.WhenAny(outbound, inbound);
          if (completed == outbound) {
            // Docker's message-pipe CloseWrite is a zero-byte message. Forward
            // that EOF as TCP FIN without truncating the daemon's response.
            await outbound;
            client.Client.Shutdown(SocketShutdown.Send);
            await inbound;
          } else {
            await inbound;
          }
          client.Close(); pipe.Dispose();
          try { await Task.WhenAll(outbound, inbound); } catch (IOException) { } catch (ObjectDisposedException) { }
        }
      } catch (Exception error) {
        Console.Error.WriteLine("Owned Docker transport connection closed (" + error.GetType().Name + ").");
      }
    }
  }

  internal static NamedPipeServerStream CreatePipe(string name) {
    var pipe = new NamedPipeServerStream(name, PipeDirection.InOut,
      NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Message,
      PipeOptions.Asynchronous, 65536, 65536);
    // Message reads retain zero-byte CloseWrite markers. NamedPipeStream still
    // returns partial messages as ordinary bytes, so payload framing is untouched.
    pipe.ReadMode = PipeTransmissionMode.Message;
    return pipe;
  }

  private static async Task Listen(string readyFile) {
    bool first = true;
    for (;;) {
      var pipe = CreatePipe("docker_engine");
      if (first) {
        File.WriteAllText(readyFile, Process.GetCurrentProcess().Id.ToString());
        first = false;
      }
      try { await pipe.WaitForConnectionAsync(); }
      catch { pipe.Dispose(); throw; }
      // Relay contains its own error handling; each accepted connection remains
      // independent, including Docker attach/exec and binary tar streams.
      var ownedConnection = Relay(pipe, 2375);
      GC.KeepAlive(ownedConnection);
    }
  }

  public static int Main(string[] args) {
    try {
      if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
          Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
          Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
          Environment.GetEnvironmentVariable("POS_ACCEPTANCE_DISPOSABLE") != "1" ||
          (Environment.GetEnvironmentVariable("ImageOS") != "win25" &&
           Environment.GetEnvironmentVariable("ImageOS") != "win25-vs2026"))
        throw new InvalidOperationException("A fresh enrolled GitHub-hosted Windows 2025 job is required.");
      if (args.Length != 1 || !Path.IsPathRooted(args[0])) throw new ArgumentException("Expected an owned absolute ready-file path.");
      var root = Path.GetFullPath(Environment.GetEnvironmentVariable("RUNNER_TEMP") ?? "").TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
      if (!Path.GetFullPath(args[0]).StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Keep the transport receipt in runner temp.");
      Listen(args[0]).GetAwaiter().GetResult();
      return 0;
    } catch (Exception error) {
      Console.Error.WriteLine("Owned Docker transport stopped (" + error.GetType().Name + ").");
      return 1;
    }
  }
}
