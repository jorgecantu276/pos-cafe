// Windows-only launcher for this local test stack. The Supabase CLI emits
// implicit port bindings that Docker Desktop publishes on every interface.
// Make those bindings explicit without changing Docker's global settings.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

class DockerLoopback {
  static string Quote(string arg) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char ch in arg) {
      if (ch == '\\') { slashes++; continue; }
      if (ch == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
      else { result.Append('\\', slashes); result.Append(ch); }
      slashes = 0;
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }
  static string Binding(string value) {
    if (value.StartsWith("127.0.0.1:")) value = value.Substring(10);
    string[] pieces = value.Split(':');
    if (pieces.Length != 2 || !new HashSet<string> {"55451","55452","55453","55454"}.Contains(pieces[0]))
      throw new Exception("Refusing unexpected staging port binding");
    return "127.0.0.1:" + value;
  }
  public static int Main(string[] args) {
    try {
      if (args.Length == 1 && args[0] == "--pos-cafe-self-test") {
        if (Binding("55451:8000") != "127.0.0.1:55451:8000" || Quote("x y\\") != "\"x y\\\\\"") return 2;
        try { Binding("0.0.0.0:55451:8000"); return 3; } catch { }
        return 0;
      }
      var binary = Environment.GetEnvironmentVariable("POS_CAFE_REAL_DOCKER");
      if (String.IsNullOrEmpty(binary) || !Path.IsPathRooted(binary) || !File.Exists(binary)) throw new Exception("Missing real Docker executable");
      bool creating = args.Length > 0 && args[0] == "create" || args.Length > 1 && args[0] == "container" && args[1] == "create";
      var rewritten = new List<string>();
      for (int i = 0; i < args.Length; i++) {
        string arg = args[i];
        if (creating && (arg == "-P" || arg == "--publish-all")) throw new Exception("Implicit publish-all is forbidden in staging");
        if (creating && (arg == "-p" || arg == "--publish")) {
          rewritten.Add(arg); if (++i >= args.Length) throw new Exception("Missing port binding");
          rewritten.Add(Binding(args[i]));
        } else if (creating && arg.StartsWith("--publish=")) rewritten.Add("--publish=" + Binding(arg.Substring(10)));
        else rewritten.Add(arg);
      }
      var quoted = new List<string>(); foreach (string arg in rewritten) quoted.Add(Quote(arg));
      var process = Process.Start(new ProcessStartInfo(binary, String.Join(" ", quoted)) {
        UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
        RedirectStandardOutput = true, RedirectStandardError = true
      });
      var input = new Thread(() => { try { Console.OpenStandardInput().CopyTo(process.StandardInput.BaseStream); process.StandardInput.Close(); } catch (IOException) { } });
      input.IsBackground = true; input.Start();
      var output = new Thread(() => process.StandardOutput.BaseStream.CopyTo(Console.OpenStandardOutput()));
      var errorOutput = new Thread(() => process.StandardError.BaseStream.CopyTo(Console.OpenStandardError()));
      output.Start(); errorOutput.Start();
      process.WaitForExit(); output.Join(); errorOutput.Join(); return process.ExitCode;
    } catch (Exception error) { Console.Error.WriteLine("Local Docker launcher: " + error.Message); return 1; }
  }
}
